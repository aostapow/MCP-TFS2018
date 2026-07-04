import {
  findReleaseZipAsset,
  zipAssetFileName,
} from './release-assets';

describe('zipAssetFileName', () => {
  it('builds the expected release zip name', () => {
    expect(zipAssetFileName('1.2.0')).toBe('MCP-TFS2018-v1.2.0.zip');
    expect(zipAssetFileName('v1.2.0')).toBe('MCP-TFS2018-v1.2.0.zip');
  });
});

describe('findReleaseZipAsset', () => {
  it('finds the exact zip asset for a version', () => {
    const asset = findReleaseZipAsset({
      tag_name: 'v1.3.0',
      assets: [
        { name: 'MCP-TFS2018-v1.3.0.zip', browser_download_url: 'https://example.com/a.zip', size: 100 },
        { name: 'checksums.txt', browser_download_url: 'https://example.com/b.txt' },
      ],
    }, '1.3.0');

    expect(asset).toEqual({
      name: 'MCP-TFS2018-v1.3.0.zip',
      downloadUrl: 'https://example.com/a.zip',
      size: 100,
    });
  });

  it('falls back to the first zip asset', () => {
    const asset = findReleaseZipAsset({
      tag_name: 'v2.0.0',
      assets: [
        { name: 'custom-bundle.zip', browser_download_url: 'https://example.com/custom.zip' },
      ],
    }, '2.0.0');

    expect(asset?.name).toBe('custom-bundle.zip');
  });

  it('returns null when no zip asset exists', () => {
    expect(findReleaseZipAsset({ tag_name: 'v1.0.0', assets: [] }, '1.0.0')).toBeNull();
    expect(findReleaseZipAsset(null, '1.0.0')).toBeNull();
  });
});
