import { describe, expect, it } from 'vitest';
import { isJsonPath, joinPath } from './paths';

describe('isJsonPath', () => {
  it('detects .json files regardless of case and surrounding spaces', () => {
    expect(isJsonPath('D:\\trees\\owl.json')).toBe(true);
    expect(isJsonPath('/a/TREE.JSON ')).toBe(true);
  });

  it('treats folders and other files as not JSON', () => {
    expect(isJsonPath('/a/trees')).toBe(false);
    expect(isJsonPath('/a/readme.txt')).toBe(false);
    expect(isJsonPath('/a/json')).toBe(false);
  });
});

describe('joinPath', () => {
  it('joins with forward slashes for POSIX folders', () => {
    expect(joinPath('/work/trees', 'sub/my-tree.json')).toBe('/work/trees/sub/my-tree.json');
    expect(joinPath('/work/trees/', 'a.json')).toBe('/work/trees/a.json');
  });

  it('joins with backslashes for Windows folders', () => {
    expect(joinPath('D:\\work\\trees', 'sub/my-tree.json')).toBe(
      'D:\\work\\trees\\sub\\my-tree.json',
    );
    expect(joinPath('D:\\', 'a.json')).toBe('D:\\a.json');
  });

  it('handles the filesystem root', () => {
    expect(joinPath('/', 'a.json')).toBe('/a.json');
  });
});
