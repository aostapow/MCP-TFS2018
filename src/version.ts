/** Injected at build time via esbuild define (see scripts/build.mjs). */
export const APP_VERSION = process.env.MCP_TFS_APP_VERSION ?? '0.0.0-dev';

export const REPO_SLUG = 'aostapow/MCP-TFS2018';

export const DEFAULT_RELEASES_URL =
  `https://api.github.com/repos/${REPO_SLUG}/releases/latest`;
