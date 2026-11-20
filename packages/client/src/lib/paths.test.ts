import { describe, expect, it } from 'vitest';
import { parentDir } from '../commands/tabCommands';
import { isJsonPath, joinPath, normalizePathKey, samePath } from './paths';

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

describe('normalizePathKey, samePath and parentDir', () => {
  it('normalizes slashes and Windows drive casing while keeping POSIX case-sensitive', () => {
    expect(normalizePathKey('D:\\Work\\Tree.json')).toBe('d:/work/tree.json');
    expect(samePath('D:\\Work\\Tree.json', 'd:/work/tree.json')).toBe(true);
    expect(samePath('/Work/Tree.json', '/work/tree.json')).toBe(false);
  });

  it('computes parentDir accurately including Windows and POSIX roots', () => {
    expect(parentDir('/a/b/tree.json')).toBe('/a/b');
    expect(parentDir('/tree.json')).toBe('/');
    expect(parentDir('C:\\a\\tree.json')).toBe('C:\\a');
    expect(parentDir('C:\\tree.json')).toBe('C:\\');
    expect(parentDir('C:/tree.json')).toBe('C:/');
    expect(parentDir('tree.json')).toBe('tree.json');
  });
});
