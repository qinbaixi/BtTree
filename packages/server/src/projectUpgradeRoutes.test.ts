import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compileProject, type ProjectFile } from '@owlbt/shared';
import { createApp } from './app';
import { sha256 } from './projectFile';

// An owl-bt.json made from an old template: no utility AI types and no blackboardKey type.
const OLD = {
  nodes: [{ name: 'Selector', isComposite: true }],
  decorators: [{ name: 'Invert', simulate: { decorator: 'invert' } }],
};

describe('project upgrade routes', () => {
  let root: string;
  let projectPath: string;
  let treePath: string;
  const app = () => createApp({ clientDist: join(root, 'no-client-build') });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'owlbt-upgrade-'));
    projectPath = join(root, 'owl-bt.json');
    treePath = join(root, 'trees', 'a.json');
    mkdirSync(join(root, 'trees'));
    writeFileSync(projectPath, `${JSON.stringify(OLD, null, '\t')}\n`);
    writeFileSync(treePath, JSON.stringify({ type: 'Selector' }));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('lists the missing built-in types for a tree of the project', async () => {
    const res = await request(app()).get('/api/project/upgrade').query({ path: treePath });
    expect(res.status).toBe(200);
    expect(res.body.projectPath).toBe(projectPath);
    expect(res.body.hash).toBe(sha256(readFileSync(projectPath, 'utf8')));
    expect(res.body.missing).toEqual([
      { kind: 'node', name: 'UtilitySelector' },
      { kind: 'decorator', name: 'Utility' },
      { kind: 'decorator', name: 'Consideration' },
    ]);
  });

  it('adds them to owl-bt.json, keeping the indentation, and then has nothing left', async () => {
    const before = readFileSync(projectPath, 'utf8');
    const res = await request(app())
      .post('/api/project/upgrade')
      .query({ path: projectPath })
      .send({ baseHash: sha256(before) });
    expect(res.status).toBe(200);
    expect(res.body.added.map((a: { name: string }) => a.name)).toEqual([
      'UtilitySelector',
      'Utility',
      'Consideration',
    ]);
    expect(res.body.addedCustomTypes).toEqual(['blackboardKey']);

    const text = readFileSync(projectPath, 'utf8');
    expect(res.body.hash).toBe(sha256(text));
    expect(text).toMatch(/^\{\n\t"nodes"/);
    const file = JSON.parse(text) as ProjectFile;
    expect(file.nodes?.map((n) => n.name)).toEqual(['Selector', 'UtilitySelector']);
    expect(file.decorators?.map((n) => n.name)).toEqual(['Invert', 'Utility', 'Consideration']);
    expect(file.types?.blackboardKey).toBeDefined();
    const compiled = compileProject(file);
    expect(compiled.nodes.UtilitySelector.simulate?.composite).toBe('utility');
    expect(compiled.decorators.Consideration.simulate?.score).toBeDefined();

    const again = await request(app()).get('/api/project/upgrade').query({ path: treePath });
    expect(again.body.missing).toEqual([]);
    const noop = await request(app())
      .post('/api/project/upgrade')
      .query({ path: treePath })
      .send({});
    expect(noop.body.added).toEqual([]);
    expect(readFileSync(projectPath, 'utf8')).toBe(text);
  });

  it('refuses when the file changed since it was read', async () => {
    const res = await request(app())
      .post('/api/project/upgrade')
      .query({ path: treePath })
      .send({ baseHash: 'stale' });
    expect(res.status).toBe(409);
    expect(readFileSync(projectPath, 'utf8')).toBe(`${JSON.stringify(OLD, null, '\t')}\n`);
  });

  it('answers 404 outside a project and 400 for relative paths', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'owlbt-none-'));
    try {
      const res = await request(app())
        .get('/api/project/upgrade')
        .query({ path: join(outside, 'x.json') });
      expect(res.status).toBe(404);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
    expect(
      (await request(app()).get('/api/project/upgrade').query({ path: 'a.json' })).status,
    ).toBe(400);
  });
});
