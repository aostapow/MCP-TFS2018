#!/usr/bin/env node
const { runUpdate } = await import('./zip-update.mjs');

const result = await runUpdate({ force: true });

if (result.updated) {
  process.stderr.write(
    `Update complete — mcp-tfs2018 v${result.latest}. Restart Claude Desktop / Cursor to load the new version.\n`,
  );
  process.exit(0);
}

if (result.reason === 'already-current' || result.reason === 'already-applied') {
  process.stderr.write(`Already up to date (v${result.latest ?? result.current}).\n`);
  process.exit(0);
}

process.stderr.write(`Update did not complete (${result.reason ?? 'unknown'}).\n`);
process.exit(result.reason === 'check-failed' || result.reason === 'apply-failed' ? 1 : 0);
