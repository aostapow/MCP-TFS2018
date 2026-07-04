import fs from 'fs';
import os from 'os';
import path from 'path';
import { APP_VERSION, DEFAULT_RELEASES_URL, REPO_SLUG } from '../version.js';
import { getUpdateConfig } from '../config.js';
import { createChildLogger } from './logger.js';
import { findReleaseZipAsset } from './release-assets.js';

const log = createChildLogger('version-check');

export interface VersionCheckResult {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  releaseNotes: string | null;
  zipAssetUrl: string | null;
  shouldNotify: boolean;
}

interface NotificationCache {
  version: string;
}

export interface LastAppliedCache {
  version: string;
  appliedAt: string;
}

export function getUpdateCacheDir(): string {
  return path.join(
    process.env.LOCALAPPDATA ?? path.join(os.homedir(), '.local', 'share'),
    'mcp-tfs2018',
  );
}

function getNotificationCacheFile(): string {
  return path.join(getUpdateCacheDir(), 'last-notified.json');
}

function getLastAppliedCacheFile(): string {
  return path.join(getUpdateCacheDir(), 'last-applied.json');
}

const CHECK_TIMEOUT_MS = 3_000;

/** Strip leading "v" and any pre-release/build suffix for comparison. */
export function normalizeVersion(version: string): string {
  const trimmed = version.trim().replace(/^v/i, '');
  const core = trimmed.split('-')[0]?.split('+')[0] ?? trimmed;
  return core;
}

/** Parse "1.2.3" into numeric [major, minor, patch]; non-numeric parts become 0. */
function parseVersionParts(version: string): [number, number, number] {
  const parts = normalizeVersion(version).split('.');
  return [
    Number.parseInt(parts[0] ?? '0', 10) || 0,
    Number.parseInt(parts[1] ?? '0', 10) || 0,
    Number.parseInt(parts[2] ?? '0', 10) || 0,
  ];
}

/** Returns 1 if a > b, -1 if a < b, 0 if equal (core semver only). */
export function compareVersions(a: string, b: string): number {
  const [aMajor, aMinor, aPatch] = parseVersionParts(a);
  const [bMajor, bMinor, bPatch] = parseVersionParts(b);
  if (aMajor !== bMajor) return aMajor > bMajor ? 1 : -1;
  if (aMinor !== bMinor) return aMinor > bMinor ? 1 : -1;
  if (aPatch !== bPatch) return aPatch > bPatch ? 1 : -1;
  return 0;
}

export function isNewerVersion(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0;
}

function readNotificationCache(): NotificationCache | null {
  try {
    const raw = fs.readFileSync(getNotificationCacheFile(), 'utf8');
    return JSON.parse(raw) as NotificationCache;
  } catch {
    return null;
  }
}

export function writeNotificationCache(version: string): void {
  const cacheDir = getUpdateCacheDir();
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(getNotificationCacheFile(), JSON.stringify({ version }, null, 2), 'utf8');
}

export function readLastAppliedVersion(): LastAppliedCache | null {
  try {
    const raw = fs.readFileSync(getLastAppliedCacheFile(), 'utf8');
    const data = JSON.parse(raw) as LastAppliedCache;
    if (!data.version) return null;
    return {
      version: normalizeVersion(data.version),
      appliedAt: data.appliedAt ?? '',
    };
  } catch {
    return null;
  }
}

export function shouldNotifyForVersion(latest: string): boolean {
  const cache = readNotificationCache();
  return cache?.version !== normalizeVersion(latest);
}

export function parseGitHubRelease(data: unknown): {
  latest: string | null;
  releaseUrl: string | null;
  releaseNotes: string | null;
} {
  if (!data || typeof data !== 'object') {
    return { latest: null, releaseUrl: null, releaseNotes: null };
  }
  const release = data as { tag_name?: string; html_url?: string; body?: string };
  const latest = release.tag_name ? normalizeVersion(release.tag_name) : null;
  return {
    latest,
    releaseUrl: release.html_url ?? null,
    releaseNotes: release.body ?? null,
  };
}

async function fetchLatestRelease(apiUrl: string): Promise<{
  latest: string | null;
  releaseUrl: string | null;
  releaseNotes: string | null;
  zipAssetUrl: string | null;
  raw: unknown;
}> {
  const response = await fetch(apiUrl, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': `mcp-tfs2018/${APP_VERSION}`,
    },
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`GitHub releases API returned ${response.status}`);
  }

  const raw = await response.json();
  const parsed = parseGitHubRelease(raw);
  const zipAsset = parsed.latest ? findReleaseZipAsset(raw, parsed.latest) : null;

  return {
    ...parsed,
    zipAssetUrl: zipAsset?.downloadUrl ?? null,
    raw,
  };
}

export async function checkForUpdates(options?: {
  force?: boolean;
}): Promise<VersionCheckResult> {
  const current = normalizeVersion(APP_VERSION);
  const baseResult: VersionCheckResult = {
    current,
    latest: null,
    updateAvailable: false,
    releaseUrl: null,
    releaseNotes: null,
    zipAssetUrl: null,
    shouldNotify: false,
  };

  const updateConfig = getUpdateConfig();
  if (!updateConfig.enabled && !options?.force) {
    return baseResult;
  }

  const apiUrl = updateConfig.url ?? DEFAULT_RELEASES_URL;

  try {
    const { latest, releaseUrl, releaseNotes, zipAssetUrl } = await fetchLatestRelease(apiUrl);
    if (!latest) {
      return baseResult;
    }

    const updateAvailable = isNewerVersion(latest, current);
    const shouldNotify = updateAvailable && (options?.force || shouldNotifyForVersion(latest));

    return {
      current,
      latest,
      updateAvailable,
      releaseUrl: releaseUrl ?? `https://github.com/${REPO_SLUG}/releases/latest`,
      releaseNotes,
      zipAssetUrl,
      shouldNotify,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.debug('Update check skipped', { err: msg });
    return baseResult;
  }
}

export async function notifyIfUpdateAvailable(): Promise<void> {
  const result = await checkForUpdates();
  if (!result.updateAvailable || !result.shouldNotify || !result.latest) {
    return;
  }

  writeNotificationCache(result.latest);

  const releaseLink = result.releaseUrl ?? `https://github.com/${REPO_SLUG}/releases/latest`;
  const updateConfig = getUpdateConfig();
  const hint = updateConfig.autoUpdate
    ? 'Auto-update is enabled via scripts/launcher.mjs; restart Cursor after the next launch applies the zip.'
    : 'Update with: npm run update (or set MCP_TFS_AUTO_UPDATE=true and use scripts/launcher.mjs).';

  log.warn(
    `MCP-TFS2018 v${result.latest} available (current: v${result.current}). ` +
    `See: ${releaseLink}. ${hint}`,
  );
}
