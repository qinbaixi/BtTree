import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';

const PROJECT_JSON = JSON.stringify({
  nodes: [{ name: 'Selector', isComposite: true }, { name: 'Wait' }],
});

describe('export routes', () => {
  let root: string;
  let noProjectDir: string;

  const app = () => createApp({ clientDist: join(root, 'no-client-build') });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'owlbt-export-routes-'));
    noProjectDir = mkdtempSync(join(tmpdir(), 'owlbt-export-noproj-'));
    mkdirSync(join(root, 'trees'), { recursive: true });
    writeFileSync(join(root, 'owl-bt.json'), PROJECT_JSON);
    writeFileSync(
      join(root, 'trees', 'good.json'),
      JSON.stringify({ type: 'Selector', childNodes: [{ type: 'Wait' }] }),
    );
    writeFileSync(
      join(root, 'trees', 'bad.json'),
      JSON.stringify({ type: 'Selector', childNodes: [{ type: 'Nope' }] }),
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(noProjectDir, { recursive: true, force: true });
  });

  describe('POST /api/export', () => {
    it('returns 400 for a missing or relative path', async () => {
      const missing = await request(app())
        .post('/api/export')
        .send({ formats: ['lua'] });
      expect(missing.status).toBe(400);
      expect(missing.text).toBe('Missing path');

      const relative = await request(app())
        .post('/api/export')
        .send({ path: 'trees/good.json', formats: ['lua'] });
      expect(relative.status).toBe(400);
      expect(relative.text).toBe('Path must be absolute');
    });

    it('returns 400 for a bad formats value', async () => {
      const treePath = join(root, 'trees', 'good.json');
      for (const formats of [undefined, [], ['python'], 'lua']) {
        const res = await request(app()).post('/api/export').send({ path: treePath, formats });
        expect(res.status).toBe(400);
      }
    });

    it('returns 400 when the body is not an object', async () => {
      const res = await request(app())
        .post('/api/export')
        .set('Content-Type', 'application/json')
        .send('[1,2]');
      expect(res.status).toBe(400);
      expect(res.text).toBe('Body must be a JSON object');
    });

    it('returns 404 when the tree has no project', async () => {
      const res = await request(app())
        .post('/api/export')
        .send({ path: join(noProjectDir, 'x.json'), formats: ['lua'] });
      expect(res.status).toBe(404);
      expect(res.text).toBe('No project found');
    });

    it('writes the files and returns them', async () => {
      const res = await request(app())
        .post('/api/export')
        .send({ path: join(root, 'trees', 'good.json'), formats: ['erlang', 'lua'] });

      expect(res.status).toBe(200);
      expect(res.body.error).toBeUndefined();
      expect(res.body.files).toEqual([
        { format: 'erlang', path: join(root, 'export', 'erlang', 'good.erl') },
        { format: 'lua', path: join(root, 'export', 'lua', 'good.lua') },
      ]);
      expect(existsSync(res.body.files[0].path)).toBe(true);
      expect(existsSync(res.body.files[1].path)).toBe(true);
    });

    it('reports a failing tree in the body with status 200', async () => {
      const res = await request(app())
        .post('/api/export')
        .send({ path: join(root, 'trees', 'bad.json'), formats: ['lua'] });
      expect(res.status).toBe(200);
      expect(res.body.error).toBe("Missing node type 'Nope' at root.childNodes[0]");
      expect(res.body.files).toEqual([]);
    });
  });

  describe('POST /api/export/batch', () => {
    it('returns 400 for a missing or relative dir and for bad formats', async () => {
      const missing = await request(app())
        .post('/api/export/batch')
        .send({ formats: ['lua'] });
      expect(missing.status).toBe(400);
      expect(missing.text).toBe('Missing dir');

      const relative = await request(app())
        .post('/api/export/batch')
        .send({ dir: 'trees', formats: ['lua'] });
      expect(relative.status).toBe(400);

      const formats = await request(app())
        .post('/api/export/batch')
        .send({ dir: join(root, 'trees'), formats: ['xml'] });
      expect(formats.status).toBe(400);
    });

    it('returns 404 when the folder is not inside a project', async () => {
      const res = await request(app())
        .post('/api/export/batch')
        .send({ dir: noProjectDir, formats: ['lua'] });
      expect(res.status).toBe(404);
      expect(res.text).toBe('No project found');
    });

    it('exports all trees and keeps the per-tree results', async () => {
      const res = await request(app())
        .post('/api/export/batch')
        .send({ dir: join(root, 'trees'), formats: ['lua'] });

      expect(res.status).toBe(200);
      expect(res.body.projectDir).toBe(root);
      expect(res.body.truncated).toBe(false);
      expect(res.body.results.map((r: { relPath: string }) => r.relPath)).toEqual([
        'trees/bad.json',
        'trees/good.json',
      ]);
      const [bad, good] = res.body.results;
      expect(bad.error).toContain("Missing node type 'Nope'");
      expect(good.files).toEqual([
        { format: 'lua', path: join(root, 'export', 'lua', 'good.lua') },
      ]);
    });
  });
});
