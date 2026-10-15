import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileProject, type ProjectFile } from '@owlbt/shared';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { exportProject, exportTree, subtreeExportMode } from './export';
import { loadSubtreeLibrary, treeRefOf } from './subtrees';

const PROJECT: ProjectFile = {
  nodes: [
    { name: 'Sequence', isComposite: true },
    { name: 'Wait' },
    { name: 'SubTree', subtree: true },
  ],
};

const ref = (path: string) => ({ type: 'SubTree', properties: [{ name: 'Tree', value: path }] });

describe('subtree references on the server', () => {
  let root: string;
  let outside: string;

  const write = (rel: string, value: unknown) => {
    const path = join(root, ...rel.split('/'));
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
    return path;
  };
  const app = () => createApp({ clientDist: join(root, 'no-client-build') });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'owlbt-subtrees-'));
    outside = mkdtempSync(join(tmpdir(), 'owlbt-subtrees-out-'));
    write('owl-bt.json', PROJECT);
    write('trees/main.json', {
      type: 'Sequence',
      childNodes: [ref('trees/common/patrol.json'), { type: 'Wait' }],
    });
    write('trees/common/patrol.json', {
      type: 'Sequence',
      childNodes: [ref('trees/common/leaf'), { type: 'Wait' }],
    });
    write('trees/common/leaf.json', { type: 'Wait', label: 'Leaf' });
    write('trees/loop-a.json', ref('trees/loop-b.json'));
    write('trees/loop-b.json', ref('trees/loop-a.json'));
    write('trees/broken.json', '{ nope');
    write('trees/notree.json', { name: 'x' });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  describe('loadSubtreeLibrary', () => {
    const compiled = compileProject(PROJECT);

    it('loads the referenced trees recursively', async () => {
      const library = await loadSubtreeLibrary(root, compiled, ['trees/common/patrol.json']);
      expect(Object.keys(library)).toEqual(['trees/common/patrol.json', 'trees/common/leaf.json']);
      expect(library['trees/common/leaf.json']).toEqual({
        path: join(root, 'trees', 'common', 'leaf.json'),
        tree: { type: 'Wait', label: 'Leaf' },
      });
    });

    it('reports missing, invalid and outside references, and loads cycles once', async () => {
      const library = await loadSubtreeLibrary(root, compiled, [
        'trees/none.json',
        'trees/broken.json',
        'trees/notree.json',
        '../x.json',
        'trees/loop-a.json',
        '',
      ]);
      expect(library['trees/none.json']).toEqual({
        error: 'missing',
        message: "Referenced tree 'trees/none.json' not found",
      });
      expect(library['trees/broken.json']).toMatchObject({ error: 'invalid' });
      expect(library['trees/notree.json']).toEqual({
        error: 'invalid',
        message: "'trees/notree.json' is not a tree file",
      });
      expect(Object.keys(library).sort()).toEqual([
        'trees/broken.json',
        'trees/loop-a.json',
        'trees/loop-b.json',
        'trees/none.json',
        'trees/notree.json',
      ]);
    });

    it('names a tree by its path in the project', () => {
      expect(treeRefOf(root, join(root, 'trees', 'main.json'))).toBe('trees/main.json');
      expect(treeRefOf(root, join(outside, 'x.json'))).toBeUndefined();
    });
  });

  describe('POST /api/subtrees', () => {
    it('resolves the references of the tree on disk', async () => {
      const res = await request(app())
        .post('/api/subtrees')
        .send({ path: join(root, 'trees', 'main.json') });
      expect(res.status).toBe(200);
      expect(res.body.projectDir).toBe(root);
      expect(res.body.self).toBe('trees/main.json');
      expect(Object.keys(res.body.library)).toEqual([
        'trees/common/patrol.json',
        'trees/common/leaf.json',
      ]);
    });

    it('resolves the given references (the unsaved tree of the editor)', async () => {
      const res = await request(app())
        .post('/api/subtrees')
        .send({ path: join(root, 'trees', 'main.json'), refs: ['trees/loop-a', 'trees/none'] });
      expect(res.status).toBe(200);
      expect(Object.keys(res.body.library).sort()).toEqual([
        'trees/loop-a.json',
        'trees/loop-b.json',
        'trees/none.json',
      ]);
      expect(res.body.library['trees/none.json'].error).toBe('missing');
    });

    it('rejects bad requests and trees outside the project', async () => {
      const bad = await request(app())
        .post('/api/subtrees')
        .send({ path: join(root, 'trees', 'main.json'), refs: 'x' });
      expect(bad.status).toBe(400);
      const noPath = await request(app()).post('/api/subtrees').send({});
      expect(noPath.status).toBe(400);
      const foreign = await request(app())
        .post('/api/subtrees')
        .send({ path: join(outside, 'x.json') });
      expect(foreign.status).toBe(403);
    });
  });

  describe('export', () => {
    const readLua = (name: string) => readFileSync(join(root, 'export', 'lua', name), 'utf8');

    it('exports reference nodes by default', async () => {
      const result = await exportTree(join(root, 'trees', 'main.json'), ['lua']);
      expect(result.error).toBeUndefined();
      expect(result.warnings).toEqual([]);
      expect(readLua('main.lua')).toContain('subtree = "patrol",');
    });

    it('inlines referenced trees when export.subtrees is "inline"', async () => {
      write('owl-bt.json', { ...PROJECT, export: { subtrees: 'inline' } });
      const result = await exportTree(join(root, 'trees', 'main.json'), ['lua']);
      expect(result.error).toBeUndefined();
      const lua = readLua('main.lua');
      expect(lua).not.toContain('subtree =');
      expect(lua).toContain('-- Wait - Leaf');
    });

    it('fails inline export of cycles and warns about them in reference mode', async () => {
      const cyclic = join(root, 'trees', 'loop-a.json');
      const reference = await exportTree(cyclic, ['lua']);
      expect(reference.error).toBeUndefined();
      expect(reference.warnings).toEqual([
        'root: Subtree cycle: trees/loop-a.json → trees/loop-b.json → trees/loop-a.json',
      ]);

      write('owl-bt.json', { ...PROJECT, export: { subtrees: 'inline' } });
      const inline = await exportTree(cyclic, ['lua']);
      expect(inline.error).toBe(
        'Cannot inline subtree at a nested subtree (trees/loop-b.json): Subtree cycle: trees/loop-a.json → trees/loop-b.json → trees/loop-a.json',
      );
    });

    it('exports a whole project in inline mode, reporting broken trees per tree', async () => {
      write('owl-bt.json', { ...PROJECT, export: { subtrees: 'inline' } });
      const result = await exportProject(root, ['lua']);
      const byPath = new Map(result.results.map((entry) => [entry.relPath, entry]));
      expect(byPath.get('trees/main.json')?.error).toBeUndefined();
      expect(byPath.get('trees/common/patrol.json')?.error).toBeUndefined();
      expect(byPath.get('trees/loop-a.json')?.error).toMatch(/Subtree cycle/);
    });

    it('reads the mode from the project file', () => {
      expect(subtreeExportMode({})).toEqual({ mode: 'reference' });
      expect(subtreeExportMode({ export: { subtrees: 'inline' } })).toEqual({ mode: 'inline' });
      expect(subtreeExportMode({ export: { subtrees: 'x' as never } })).toEqual({
        mode: 'reference',
        warning: 'Unknown export.subtrees value "x"; using "reference"',
      });
    });
  });
});
