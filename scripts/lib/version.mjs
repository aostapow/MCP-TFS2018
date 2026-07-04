/** Pure version/release helpers for scripts/ (no TypeScript build required). */

export function normalizeVersion(version) {
  const trimmed = version.trim().replace(/^v/i, '');
  const core = trimmed.split('-')[0]?.split('+')[0] ?? trimmed;
  return core;
}

function parseVersionParts(version) {
  const parts = normalizeVersion(version).split('.');
  return [
    Number.parseInt(parts[0] ?? '0', 10) || 0,
    Number.parseInt(parts[1] ?? '0', 10) || 0,
    Number.parseInt(parts[2] ?? '0', 10) || 0,
  ];
}

export function compareVersions(a, b) {
  const [aMajor, aMinor, aPatch] = parseVersionParts(a);
  const [bMajor, bMinor, bPatch] = parseVersionParts(b);
  if (aMajor !== bMajor) return aMajor > bMajor ? 1 : -1;
  if (aMinor !== bMinor) return aMinor > bMinor ? 1 : -1;
  if (aPatch !== bPatch) return aPatch > bPatch ? 1 : -1;
  return 0;
}

export function isNewerVersion(latest, current) {
  return compareVersions(latest, current) > 0;
}

export function parseGitHubRelease(data) {
  if (!data || typeof data !== 'object') {
    return { latest: null, releaseUrl: null, releaseNotes: null };
  }
  const latest = data.tag_name ? normalizeVersion(data.tag_name) : null;
  return {
    latest,
    releaseUrl: data.html_url ?? null,
    releaseNotes: data.body ?? null,
  };
}

export function zipAssetFileName(version) {
  return `MCP-TFS2018-v${normalizeVersion(version)}.zip`;
}

export function findZipAsset(data, version) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.assets) || data.assets.length === 0) {
    return null;
  }

  const expectedName = zipAssetFileName(version);
  const exact = data.assets.find((a) => a.name === expectedName);
  const candidate = exact ?? data.assets.find((a) => a.name?.toLowerCase().endsWith('.zip'));

  if (!candidate?.name || !candidate.browser_download_url) {
    return null;
  }

  return {
    name: candidate.name,
    downloadUrl: candidate.browser_download_url,
    size: candidate.size,
  };
}
