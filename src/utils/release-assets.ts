/** Strip leading "v" and any pre-release/build suffix for comparison. */
function normalizeVersion(version: string): string {
  const trimmed = version.trim().replace(/^v/i, '');
  const core = trimmed.split('-')[0]?.split('+')[0] ?? trimmed;
  return core;
}

export interface GitHubReleaseAsset {
  name?: string;
  browser_download_url?: string;
  size?: number;
}

export interface GitHubReleaseResponse {
  tag_name?: string;
  html_url?: string;
  body?: string;
  assets?: GitHubReleaseAsset[];
}

export interface ReleaseZipAsset {
  name: string;
  downloadUrl: string;
  size?: number;
}

export function zipAssetFileName(version: string): string {
  return `MCP-TFS2018-v${normalizeVersion(version)}.zip`;
}

export function findReleaseZipAsset(
  data: unknown,
  version: string,
): ReleaseZipAsset | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const release = data as GitHubReleaseResponse;
  const assets = release.assets;
  if (!Array.isArray(assets) || assets.length === 0) {
    return null;
  }

  const expectedName = zipAssetFileName(version);
  const exact = assets.find((a) => a.name === expectedName);
  const candidate = exact ?? assets.find((a) => a.name?.toLowerCase().endsWith('.zip'));

  if (!candidate?.name || !candidate.browser_download_url) {
    return null;
  }

  return {
    name: candidate.name,
    downloadUrl: candidate.browser_download_url,
    size: candidate.size,
  };
}
