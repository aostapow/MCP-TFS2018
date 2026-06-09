#!/usr/bin/env node
import { spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_SLUG = 'aostapow/MCP-TFS2018';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function readVersion() {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  return pkg.version ?? 'unknown';
}

if (!existsSync(join(root, '.git'))) {
  console.error('This installation is not a git clone (.git folder missing).');
  console.error(`Download the latest release zip from: https://github.com/${REPO_SLUG}/releases/latest`);
  process.exit(1);
}

console.log('Fetching latest changes...');
run('git', ['fetch', 'origin']);
run('git', ['checkout', 'main']);
run('git', ['pull', 'origin', 'main']);

console.log('Installing dependencies...');
run('npm', ['ci']);

console.log('Building...');
run('npm', ['run', 'build']);

console.log(`Update complete — mcp-tfs2018 v${readVersion()}`);
console.log('Restart Claude Desktop / Cursor to load the new version.');
