import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findProjectFile, getProject, isPathInDir } from './project';

const PROJECT_JSON = JSON.stringify({ nodes: [{ name: 'Selector', isComposite: true }] });

describe('project discovery', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'owlbt-project-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('finds owl-bt.json by walking up from the tree directory', async () => {
    writeFileSync(join(root, 'owl-bt.json'), PROJECT_JSON);
    mkdirSync(join(root, 'a', 'b'), { recursive: true });
    const treePath = join(root, 'a', 'b', 'tree.json');

    expect(await findProjectFile(treePath)).toBe(join(root, 'owl-bt.json'));
  });

  it('prefers the nearest owl-bt.json', async () => {
    writeFileSync(join(root, 'owl-bt.json'), PROJECT_JSON);
    mkdirSync(join(root, 'a'), { recursive: true });
    writeFileSync(join(root, 'a', 'owl-bt.json'), PROJECT_JSON);

    expect(await findProjectFile(join(root, 'a', 'tree.json'))).toBe(
      join(root, 'a', 'owl-bt.json'),
    );
  });

  it('returns undefined when no ancestor has a project file', async () => {
    mkdirSync(join(root, 'empty'), { recursive: true });
    // The temp dir ancestors are assumed to hold no owl-bt.json.
    const found = await findProjectFile(join(root, 'empty', 'tree.json'));
    expect(found).toBeUndefined();
  });

  it('getProject returns content without a plugin when owl-bt.js is absent', async () => {
    writeFileSync(join(root, 'owl-bt.json'), PROJECT_JSON);
    const project = await getProject(join(root, 'tree.json'));

    expect(project?.path).toBe(join(root, 'owl-bt.json'));
    expect(project?.dir).toBe(root);
    expect(project?.content).toBe(PROJECT_JSON);
    expect(project?.plugin).toBeUndefined();
  });

  it('getProject loads the plugin and picks up edits on every call', async () => {
    writeFileSync(join(root, 'owl-bt.json'), PROJECT_JSON);
    const pluginPath = join(root, 'owl-bt.js');
    writeFileSync(pluginPath, 'module.exports = { onTreeSave() { return "v1"; } };');
    const treePath = join(root, 'tree.json');

    const first = await getProject(treePath, { trustAllPlugins: true });
    expect(first?.plugin?.onTreeSave?.({} as never)).toBe('v1');

    writeFileSync(pluginPath, 'module.exports = { onTreeSave() { return "v2"; } };');
    const second = await getProject(treePath, { trustAllPlugins: true });
    expect(second?.plugin?.onTreeSave?.({} as never)).toBe('v2');
  });

  it('returns undefined when there is no project', async () => {
    mkdirSync(join(root, 'x'), { recursive: true });
    expect(await getProject(join(root, 'x', 'tree.json'))).toBeUndefined();
  });
});

describe('isPathInDir', () => {
  it('accepts paths inside the directory', () => {
    expect(isPathInDir(join('/work', 'proj', 'a', 'tree.json'), join('/work', 'proj'))).toBe(true);
  });

  it('rejects siblings, parents and prefixes', () => {
    expect(isPathInDir(join('/work', 'other', 'tree.json'), join('/work', 'proj'))).toBe(false);
    expect(isPathInDir(join('/work', 'tree.json'), join('/work', 'proj'))).toBe(false);
    expect(isPathInDir(join('/work', 'proj2', 'tree.json'), join('/work', 'proj'))).toBe(false);
  });

  it('accepts names that merely start with two dots', () => {
    expect(isPathInDir(join('/work', 'proj', '..name', 'tree.json'), join('/work', 'proj'))).toBe(
      true,
    );
  });

  it('is case-insensitive on win32 only', () => {
    const file = 'C:\\Work\\Proj\\tree.json';
    const dir = 'c:\\work\\proj';
    expect(isPathInDir(file, dir)).toBe(process.platform === 'win32');
  });
});
