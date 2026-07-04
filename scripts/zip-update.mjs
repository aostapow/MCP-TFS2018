#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import {
  findZipAsset,
  isNewerVersion,
  normalizeVersion,
  parseGitHubRelease,
} from './lib/version.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const installDir = path.resolve(__dirname, '..');
const REPO_SLUG = 'aostapow/MCP-TFS2018';
const DEFAULT_RELEASES_URL = `https://api.github.com/repos/${REPO_SLUG}/releases/latest`;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const CHECK_TIMEOUT_MS = 30_000;
const LOCK_STALE_MS = 10 * 60 * 1000;

function getCacheDir() {
  return path.join(
    process.env.LOCALAPPDATA ?? path.join(os.homedir(), '.local', 'share'),
    'mcp-tfs2018',
  );
}

function readPackageVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(installDir, 'package.json'), 'utf8'));
  return normalizeVersion(pkg.version ?? '0.0.0');
}

function readLastApplied() {
  try {
    const raw = fs.readFileSync(path.join(getCacheDir(), 'last-applied.json'), 'utf8');
    const data = JSON.parse(raw);
    return data.version ? normalizeVersion(data.version) : null;
  } catch {
    return null;
  }
}

function writeLastApplied(version) {
  const dir = getCacheDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'last-applied.json'),
    JSON.stringify(
      { version: normalizeVersion(version), appliedAt: new Date().toISOString() },
      null,
      2,
    ),
    'utf8',
  );
}

function envFlagEnabled(name, defaultValue = true) {
  const value = process.env[name];
  if (value === undefined) return defaultValue;
  return value !== 'false' && value !== '0';
}

function logInfo(message) {
  process.stderr.write(`[mcp-tfs2018:update] ${message}\n`);
}

function logWarn(message) {
  process.stderr.write(`[mcp-tfs2018:update] WARN: ${message}\n`);
}

function logError(message) {
  process.stderr.write(`[mcp-tfs2018:update] ERROR: ${message}\n`);
}

function acquireLock() {
  const lockPath = path.join(getCacheDir(), 'update.lock');
  fs.mkdirSync(getCacheDir(), { recursive: true });

  if (fs.existsSync(lockPath)) {
    const stat = fs.statSync(lockPath);
    if (Date.now() - stat.mtimeMs < LOCK_STALE_MS) {
      return null;
    }
    fs.unlinkSync(lockPath);
  }

  fs.writeFileSync(lockPath, String(process.pid), 'utf8');
  return lockPath;
}

function releaseLock(lockPath) {
  if (!lockPath) return;
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // ignore
  }
}

async function fetchLatestRelease(apiUrl, currentVersion) {
  const response = await fetch(apiUrl, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': `mcp-tfs2018/${currentVersion}`,
    },
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`GitHub releases API returned ${response.status}`);
  }

  return response.json();
}

async function downloadFile(url, destPath, expectedSize) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'mcp-tfs2018' },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Download failed: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (expectedSize && buffer.length !== expectedSize) {
    logWarn(`Download size ${buffer.length} differs from expected ${expectedSize}`);
  }

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buffer);
}

function copyRecursive(src, dest, skipNames = new Set(['.env'])) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      if (skipNames.has(entry)) continue;
      copyRecursive(path.join(src, entry), path.join(dest, entry), skipNames);
    }
    return;
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function cleanupTemp(...paths) {
  for (const target of paths) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

function extractZipArchive(zipPath, destDir) {
  return import('adm-zip')
    .then(({ default: AdmZip }) => {
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(destDir, true);
    })
    .catch((err) => {
      if (process.platform !== 'win32') {
        throw err;
      }
      const psPath = zipPath.replace(/'/g, "''");
      const psDest = destDir.replace(/'/g, "''");
      const result = spawnSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `Expand-Archive -LiteralPath '${psPath}' -DestinationPath '${psDest}' -Force`,
        ],
        { stdio: 'inherit' },
      );
      if (result.status !== 0) {
        throw new Error(`Expand-Archive failed with code ${result.status ?? 1}`);
      }
    });
}

/**
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<{ updated: boolean; reason?: string; current?: string; latest?: string; previous?: string; error?: string }>}
 */
export async function runUpdate(options = {}) {
  const { force = false } = options;

  dotenv.config({ path: path.join(installDir, '.env') });

  if (!force && !envFlagEnabled('MCP_TFS_AUTO_UPDATE', true)) {
    return { updated: false, reason: 'auto-update-disabled' };
  }
  if (!force && !envFlagEnabled('MCP_TFS_UPDATE_CHECK', true)) {
    return { updated: false, reason: 'update-check-disabled' };
  }

  const current = readPackageVersion();
  const apiUrl = process.env.MCP_TFS_UPDATE_URL ?? DEFAULT_RELEASES_URL;

  let releaseData;
  try {
    releaseData = await fetchLatestRelease(apiUrl, current);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError(`Update check failed: ${message}`);
    return { updated: false, reason: 'check-failed', current, error: message };
  }

  const parsed = parseGitHubRelease(releaseData);
  if (!parsed.latest) {
    logWarn('Could not determine latest version from release API');
    return { updated: false, reason: 'no-latest', current };
  }

  const latest = parsed.latest;

  if (!isNewerVersion(latest, current)) {
    return { updated: false, reason: 'already-current', current, latest };
  }

  const lastApplied = readLastApplied();
  if (!force && lastApplied === latest) {
    return { updated: false, reason: 'already-applied', current, latest };
  }

  const zipAsset = findZipAsset(releaseData, latest);
  if (!zipAsset) {
    logWarn(`No zip asset found for v${latest}`);
    return { updated: false, reason: 'no-zip-asset', current, latest };
  }

  const lockPath = acquireLock();
  if (!lockPath) {
    logWarn('Another update is in progress, skipping');
    return { updated: false, reason: 'locked', current, latest };
  }

  const tempRoot = path.join(os.tmpdir(), 'mcp-tfs2018');
  const zipPath = path.join(tempRoot, `download-v${latest}.zip`);
  const stagingDir = path.join(tempRoot, `staging-v${latest}`);

  try {
    logInfo(`Updating from v${current} to v${latest}...`);
    await downloadFile(zipAsset.downloadUrl, zipPath, zipAsset.size);

    cleanupTemp(stagingDir);
    fs.mkdirSync(stagingDir, { recursive: true });

    await extractZipArchive(zipPath, stagingDir);

    copyRecursive(stagingDir, installDir, new Set(['.env']));

    logInfo('Running npm ci...');
    const npmResult = spawnSync('npm', ['ci'], {
      cwd: installDir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    if (npmResult.status !== 0) {
      throw new Error(`npm ci exited with code ${npmResult.status ?? 1}`);
    }

    writeLastApplied(latest);
    logInfo(`Update complete — mcp-tfs2018 v${latest}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError(`Update failed: ${message}. Continuing with current installation.`);
    return { updated: false, reason: 'apply-failed', current, latest, error: message };
  } finally {
    releaseLock(lockPath);
    cleanupTemp(zipPath, stagingDir);
  }

  return { updated: true, previous: current, latest };
}
