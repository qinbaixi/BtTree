import { describe, expect, it } from 'vitest';
import { compareVersions, isNewerVersion, parseLatestRelease, RELEASES_URL } from './appUpdate';

describe('compareVersions', () => {
  it('orders by major, minor and patch numerically', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1);
    expect(compareVersions('1.0.0', '1.0.1')).toBe(-1);
    expect(compareVersions('v0.2.0', '0.2.0')).toBe(0);
  });

  it('puts prereleases before their release', () => {
    expect(compareVersions('0.3.0-beta.1', '0.3.0')).toBe(-1);
    expect(compareVersions('0.3.0', '0.3.0-beta.1')).toBe(1);
    expect(compareVersions('0.3.0-beta.2', '0.3.0-beta.10')).toBe(-1);
    expect(compareVersions('0.3.0-alpha', '0.3.0-beta')).toBe(-1);
  });

  it('returns undefined for anything that is not a version', () => {
    expect(compareVersions('latest', '0.2.0')).toBeUndefined();
    expect(compareVersions('0.2', '0.2.0')).toBeUndefined();
  });
});

describe('isNewerVersion', () => {
  it('is true only for a strictly newer version', () => {
    expect(isNewerVersion('0.3.0', '0.2.0')).toBe(true);
    expect(isNewerVersion('0.2.0', '0.2.0')).toBe(false);
    expect(isNewerVersion('0.1.0', '0.2.0')).toBe(false);
    expect(isNewerVersion('nightly', '0.2.0')).toBe(false);
  });
});

describe('parseLatestRelease', () => {
  it('reads the tag without its v prefix and the release page', () => {
    expect(
      parseLatestRelease({
        tag_name: 'v0.3.0',
        html_url: 'https://github.com/qinbaixi/BtTree/releases/tag/v0.3.0',
      }),
    ).toEqual({ version: '0.3.0', url: 'https://github.com/qinbaixi/BtTree/releases/tag/v0.3.0' });
  });

  it('falls back to the releases page for a missing or non-https url', () => {
    expect(parseLatestRelease({ tag_name: '0.3.0' })).toEqual({
      version: '0.3.0',
      url: RELEASES_URL,
    });
    expect(parseLatestRelease({ tag_name: 'v0.3.0', html_url: 'javascript:alert(1)' })?.url).toBe(
      RELEASES_URL,
    );
  });

  it('rejects responses without a version tag', () => {
    expect(parseLatestRelease(null)).toBeUndefined();
    expect(parseLatestRelease({ message: 'Not Found' })).toBeUndefined();
    expect(parseLatestRelease({ tag_name: 'nightly' })).toBeUndefined();
  });
});
