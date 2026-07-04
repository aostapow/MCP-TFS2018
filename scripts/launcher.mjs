#!/usr/bin/env node
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const installDir = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(installDir, '.env') });

const autoUpdateEnabled = (() => {
  const value = process.env.MCP_TFS_AUTO_UPDATE;
  if (value === undefined) return true;
  return value !== 'false' && value !== '0';
})();

if (autoUpdateEnabled) {
  try {
    const { runUpdate } = await import('./zip-update.mjs');
    await runUpdate();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[mcp-tfs2018:launcher] Update step failed: ${message}\n`);
  }
}

const indexPath = path.join(installDir, 'dist', 'index.js');
const child = spawn(process.execPath, [indexPath], {
  stdio: 'inherit',
  env: process.env,
  cwd: installDir,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on('error', (err) => {
  process.stderr.write(`[mcp-tfs2018:launcher] Failed to start MCP server: ${err.message}\n`);
  process.exit(1);
});
