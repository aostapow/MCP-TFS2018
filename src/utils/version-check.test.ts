import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  compareVersions,
  isNewerVersion,
  normalizeVersion,
  parseGitHubRelease,
  shouldNotifyForVersion,
  writeNotificationCache,
} from './version-check';

describe('normalizeVersion', () => {
  it('strips leading v and pre-release suffix', () => {
    expect(normalizeVersion('v1.2.3')).toBe('1.2.3');
    expect(normalizeVersion('1.2.3-beta.1')).toBe('1.2.3');
    expect(normalizeVersion('2.0.0+build.1')).toBe('2.0.0');
  });
});

describe('compareVersions', () => {
  it('orders semver core versions correctly', () => {
    expect(compareVersions('1.1.0', '1.0.0')).toBe(1);
    expect(compareVersions('1.0.0', '1.1.0')).toBe(-1);
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });
});

describe('isNewerVersion', () => {
  it('detects newer releases', () => {
    expect(isNewerVersion('1.1.0', '1.0.0')).toBe(true);
    expect(isNewerVersion('1.0.0', '1.0.1')).toBe(false);
  });
});

describe('parseGitHubRelease', () => {
  it('parses tag_name and metadata from GitHub API response', () => {
    const parsed = parseGitHubRelease({
      tag_name: 'v1.2.0',
      html_url: 'https://github.com/aostapow/MCP-TFS2018/releases/tag/v1.2.0',
      body: 'Release notes',
    });
    expect(parsed.latest).toBe('1.2.0');
    expect(parsed.releaseUrl).toContain('releases/tag');
    expect(parsed.releaseNotes).toBe('Release notes');
  });

  it('returns nulls for invalid payloads', () => {
    expect(parseGitHubRelease(null)).toEqual({
      latest: null,
      releaseUrl: null,
      releaseNotes: null,
    });
  });
});

describe('notification cache', () => {
  const cacheRoot = path.join(os.tmpdir(), `mcp-tfs2018-test-${process.pid}`);
  const cacheDir = path.join(cacheRoot, 'mcp-tfs2018');
  const cacheFile = path.join(cacheDir, 'last-notified.json');
  let originalLocalAppData: string | undefined;

  beforeEach(() => {
    originalLocalAppData = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = cacheRoot;
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  });

  afterEach(() => {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
    if (originalLocalAppData === undefined) {
      delete process.env.LOCALAPPDATA;
    } else {
      process.env.LOCALAPPDATA = originalLocalAppData;
    }
  });

  it('does not notify twice for the same version', () => {
    expect(shouldNotifyForVersion('1.2.0')).toBe(true);
    writeNotificationCache('1.2.0');
    expect(fs.existsSync(cacheFile)).toBe(true);
    expect(shouldNotifyForVersion('1.2.0')).toBe(false);
    expect(shouldNotifyForVersion('1.3.0')).toBe(true);
  });
});
