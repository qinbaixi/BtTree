import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HttpError } from './errors';
import {
  initProject,
  loadWorkspace,
  MAX_TREE_FILE_BYTES,
  MAX_TREE_RESULTS,
  readTemplate,
  templatesDir,
  TEMPLATES_DIR,
  withJsonExtension,
} from './workspace';

const PROJECT_JSON = JSON.stringify({ nodes: [{ name: 'Selector', isComposite: true }] });

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

describe('loadWorkspace', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'owlbt-workspace-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('lists JSON files with a string type, sorted by relative path', async () => {
    write(join(root, 'trees', 'b.json'), '{"type":"Selector"}');
    write(join(root, 'a.json'), '{"type":"Sequence"}');
    write(join(root, 'trees', 'deep', 'c.json'), '{"type":"Wait"}');

    const ws = await loadWorkspace(root);

    expect(ws.dir).toBe(root);
    expect(ws.truncated).toBe(false);
    expect(ws.trees.map((t) => t.relPath)).toEqual(['a.json', 'trees/b.json', 'trees/deep/c.json']);
    expect(ws.trees[0].path).toBe(join(root, 'a.json'));
    expect(ws.projectPath).toBeUndefined();
    expect('projectDir' in ws).toBe(false);
  });

  it('ignores JSON that is not a tree, invalid JSON, arrays and non-string types', async () => {
    write(join(root, 'arr.json'), '[{"type":"x"}]');
    write(join(root, 'num.json'), '{"type":5}');
    write(join(root, 'none.json'), '{"name":"x"}');
    write(join(root, 'broken.json'), '{ not json');
    write(join(root, 'tree.json'), '{"type":"Selector"}');
    write(join(root, 'notes.txt'), '{"type":"Selector"}');

    const ws = await loadWorkspace(root);
    expect(ws.trees.map((t) => t.relPath)).toEqual(['tree.json']);
  });

  it('skips project and package files, tsconfig files, node_modules and dot folders', async () => {
    write(join(root, 'owl-bt.json'), PROJECT_JSON);
    write(join(root, 'package.json'), '{"type":"module"}');
    write(join(root, 'package-lock.json'), '{"type":"x"}');
    write(join(root, 'tsconfig.json'), '{"type":"x"}');
    write(join(root, 'tsconfig.build.json'), '{"type":"x"}');
    write(join(root, 'node_modules', 'pkg', 'tree.json'), '{"type":"x"}');
    write(join(root, '.git', 'tree.json'), '{"type":"x"}');
    write(join(root, '.hidden', 'tree.json'), '{"type":"x"}');
    write(join(root, 'real.json'), '{"type":"Selector"}');

    const ws = await loadWorkspace(root);
    expect(ws.trees.map((t) => t.relPath)).toEqual(['real.json']);
  });

  it('skips tree files larger than 5 MB', async () => {
    const padding = 'a'.repeat(MAX_TREE_FILE_BYTES);
    write(join(root, 'huge.json'), `{"type":"Selector","pad":"${padding}"}`);
    write(join(root, 'small.json'), '{"type":"Selector"}');

    const ws = await loadWorkspace(root);
    expect(ws.trees.map((t) => t.relPath)).toEqual(['small.json']);
  });

  it('searches at most six folder levels deep', async () => {
    write(join(root, 'a', 'b', 'c', 'd', 'e', 'f', 'inside.json'), '{"type":"Selector"}');
    write(join(root, 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'outside.json'), '{"type":"Selector"}');

    const ws = await loadWorkspace(root);
    expect(ws.trees.map((t) => t.relPath)).toEqual(['a/b/c/d/e/f/inside.json']);
  });

  it('reports the project and scans from the project directory', async () => {
    write(join(root, 'owl-bt.json'), PROJECT_JSON);
    write(join(root, 'trees', 'top.json'), '{"type":"Selector"}');
    write(join(root, 'trees', 'sub', 'inner.json'), '{"type":"Selector"}');
    const sub = join(root, 'trees', 'sub');

    const ws = await loadWorkspace(sub);

    expect(ws.dir).toBe(sub);
    expect(ws.projectPath).toBe(join(root, 'owl-bt.json'));
    expect(ws.projectDir).toBe(root);
    expect(ws.trees.map((t) => t.relPath)).toEqual(['trees/sub/inner.json', 'trees/top.json']);
  });

  it('uses the folder of a file that is given instead of a folder', async () => {
    write(join(root, 'trees', 'one.json'), '{"type":"Selector"}');
    const file = join(root, 'trees', 'one.json');

    const ws = await loadWorkspace(file);

    expect(ws.dir).toBe(join(root, 'trees'));
    expect(ws.trees.map((t) => t.relPath)).toEqual(['one.json']);
  });

  it('caps the result at 500 entries and reports truncation', async () => {
    for (let i = 0; i <= MAX_TREE_RESULTS; i++) {
      write(join(root, 'many', `t${String(i).padStart(4, '0')}.json`), '{"type":"Selector"}');
    }

    const ws = await loadWorkspace(root);
    expect(ws.trees).toHaveLength(MAX_TREE_RESULTS);
    expect(ws.truncated).toBe(true);
  });

  it('is not truncated at exactly 500 entries', async () => {
    for (let i = 0; i < MAX_TREE_RESULTS; i++) {
      write(join(root, `t${String(i).padStart(4, '0')}.json`), '{"type":"Selector"}');
    }
    const ws = await loadWorkspace(root);
    expect(ws.trees).toHaveLength(MAX_TREE_RESULTS);
    expect(ws.truncated).toBe(false);
  });

  it('throws 404 for a missing path', async () => {
    const error = await loadWorkspace(join(root, 'missing')).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(404);
  });
});

describe('initProject', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'owlbt-init-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('writes owl-bt.json and trees/example.json', async () => {
    const ws = await initProject(root);

    expect(readFileSync(join(root, 'owl-bt.json'), 'utf8')).toBe(await readTemplate('owl-bt.json'));
    expect(readFileSync(join(root, 'trees', 'example.json'), 'utf8')).toBe(
      await readTemplate('example-tree.json'),
    );
    expect(ws.projectPath).toBe(join(root, 'owl-bt.json'));
    expect(ws.trees.map((t) => t.relPath)).toEqual(['trees/example.json']);
  });

  it('keeps an existing trees/example.json', async () => {
    write(join(root, 'trees', 'example.json'), '{"type":"custom"}');
    await initProject(root);
    expect(readFileSync(join(root, 'trees', 'example.json'), 'utf8')).toBe('{"type":"custom"}');
  });

  it('refuses a folder that is already inside a project', async () => {
    write(join(root, 'owl-bt.json'), PROJECT_JSON);
    mkdirSync(join(root, 'sub'));

    const error = await initProject(join(root, 'sub')).catch((err: unknown) => err);
    expect((error as HttpError).status).toBe(409);
  });

  it('refuses when owl-bt.json already exists in the folder', async () => {
    write(join(root, 'owl-bt.json'), PROJECT_JSON);
    await expect(initProject(root)).rejects.toMatchObject({ status: 409 });
  });

  it('throws 404 when the folder does not exist', async () => {
    await expect(initProject(join(root, 'nope'))).rejects.toMatchObject({ status: 404 });
  });
});

describe('withJsonExtension', () => {
  it('appends .json unless already present', () => {
    expect(withJsonExtension('/a/tree')).toBe('/a/tree.json');
    expect(withJsonExtension('/a/tree.json')).toBe('/a/tree.json');
    expect(withJsonExtension('/a/TREE.JSON')).toBe('/a/TREE.JSON');
  });
});

describe('templatesDir', () => {
  it('uses OWLBT_TEMPLATES_DIR when set and the shipped templates otherwise', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'owlbt-tpl-'));
    try {
      writeFileSync(join(dir, 'tree.json'), '{"type":"Custom"}');
      expect(templatesDir({ OWLBT_TEMPLATES_DIR: dir })).toBe(dir);
      expect(templatesDir({})).toBe(TEMPLATES_DIR);

      const saved = process.env.OWLBT_TEMPLATES_DIR;
      process.env.OWLBT_TEMPLATES_DIR = dir;
      try {
        expect(await readTemplate('tree.json')).toBe('{"type":"Custom"}');
      } finally {
        if (saved === undefined) {
          delete process.env.OWLBT_TEMPLATES_DIR;
        } else {
          process.env.OWLBT_TEMPLATES_DIR = saved;
        }
      }
      expect(await readTemplate('owl-bt.json')).toContain('"types"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
