import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';

const PROJECT_JSON = JSON.stringify({ nodes: [{ name: 'Selector', isComposite: true }] });

describe('API routes', () => {
  let root: string;
  let noProjectDir: string;
  let treePath: string;

  const app = () => createApp({ clientDist: join(root, 'no-client-build'), trustAllPlugins: true });
  const writePlugin = (source: string) => writeFileSync(join(root, 'owl-bt.js'), source);
  const removePlugin = () => rmSync(join(root, 'owl-bt.js'), { force: true });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'owlbt-routes-'));
    noProjectDir = mkdtempSync(join(tmpdir(), 'owlbt-noproj-'));
    mkdirSync(join(root, 'trees'), { recursive: true });
    writeFileSync(join(root, 'owl-bt.json'), PROJECT_JSON);
    treePath = join(root, 'trees', 'tree.json');
    writeFileSync(treePath, JSON.stringify({ type: 'Selector', name: 'rootNode' }));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(noProjectDir, { recursive: true, force: true });
  });

  describe('GET /api/health', () => {
    it('responds with ok', async () => {
      const res = await request(app()).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });
  });

  describe('GET /api/project', () => {
    it('returns 400 when path is missing', async () => {
      const res = await request(app()).get('/api/project');
      expect(res.status).toBe(400);
      expect(res.text).toBe('Missing path');
    });

    it('returns 400 when path is relative', async () => {
      const res = await request(app()).get('/api/project').query({ path: 'trees/tree.json' });
      expect(res.status).toBe(400);
      expect(res.text).toBe('Path must be absolute');
    });

    it('returns 404 when no project exists', async () => {
      mkdirSync(noProjectDir, { recursive: true });
      const res = await request(app())
        .get('/api/project')
        .query({ path: join(noProjectDir, 'x.json') });
      expect(res.status).toBe(404);
      expect(res.text).toBe('No project found');
    });

    it('returns the raw project content as JSON', async () => {
      const res = await request(app()).get('/api/project').query({ path: treePath });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.text).toBe(PROJECT_JSON);
    });
  });

  describe('GET /api/tree', () => {
    it('returns 400 when path is missing or relative', async () => {
      expect((await request(app()).get('/api/tree')).status).toBe(400);
      const relative = await request(app()).get('/api/tree').query({ path: 'tree.json' });
      expect(relative.status).toBe(400);
      expect(relative.text).toBe('Path must be absolute');
    });

    it('returns 403 when the tree is not in a project', async () => {
      mkdirSync(noProjectDir, { recursive: true });
      const file = join(noProjectDir, 'tree.json');
      writeFileSync(file, '{}');
      const res = await request(app()).get('/api/tree').query({ path: file });
      expect(res.status).toBe(403);
      expect(res.text).toBe('Path must be in project');
    });

    it('returns 404 when the tree file is missing', async () => {
      const res = await request(app())
        .get('/api/tree')
        .query({ path: join(root, 'trees', 'missing.json') });
      expect(res.status).toBe(404);
      expect(res.text).toBe('Path not found');
    });

    it('returns 422 with a JSON message when the tree file is invalid JSON', async () => {
      writeFileSync(treePath, '{ not json');
      const res = await request(app()).get('/api/tree').query({ path: treePath });
      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/^Invalid JSON in tree file: /);
    });

    it('returns the parsed tree', async () => {
      const res = await request(app()).get('/api/tree').query({ path: treePath });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ type: 'Selector', name: 'rootNode' });
    });

    it('returns the tree as modified by onTreeLoad', async () => {
      writePlugin(
        `module.exports = { onTreeLoad(ctx) { ctx.tree.label = 'loaded:' + ctx.project.nodes[0].name; } };`,
      );
      const res = await request(app()).get('/api/tree').query({ path: treePath });
      expect(res.status).toBe(200);
      expect(res.body.label).toBe('loaded:Selector');
    });

    it('does not fail when the plugin has no onTreeLoad hook', async () => {
      writePlugin('module.exports = {};');
      const res = await request(app()).get('/api/tree').query({ path: treePath });
      expect(res.status).toBe(200);
    });

    it('returns 500 when the plugin throws', async () => {
      writePlugin('module.exports = { onTreeLoad() { throw new Error("plugin broke"); } };');
      const res = await request(app()).get('/api/tree').query({ path: treePath });
      expect(res.status).toBe(500);
      expect(res.text).toBe('plugin broke');
    });
  });

  describe('POST /api/tree', () => {
    it('returns 415 when the content type is not JSON', async () => {
      const res = await request(app())
        .post('/api/tree')
        .query({ path: treePath })
        .set('Content-Type', 'text/plain')
        .send('{"type":"Selector"}');
      expect(res.status).toBe(415);
    });

    it('returns 415 for PUT without JSON content type', async () => {
      const res = await request(app())
        .put('/api/tree')
        .query({ path: treePath })
        .set('Content-Type', 'text/plain')
        .send('x');
      expect(res.status).toBe(415);
    });

    it('returns 400 when path is missing or relative', async () => {
      const missing = await request(app()).post('/api/tree').send({ type: 'Selector' });
      expect(missing.status).toBe(400);
      const relative = await request(app())
        .post('/api/tree')
        .query({ path: 'tree.json' })
        .send({ type: 'Selector' });
      expect(relative.status).toBe(400);
    });

    it('returns 403 when the tree is not in a project', async () => {
      mkdirSync(noProjectDir, { recursive: true });
      const res = await request(app())
        .post('/api/tree')
        .query({ path: join(noProjectDir, 'tree.json') })
        .send({ type: 'Selector' });
      expect(res.status).toBe(403);
      expect(res.text).toBe('Path must be in project');
    });

    it('returns 400 when the body is not a JSON object', async () => {
      const res = await request(app())
        .post('/api/tree')
        .query({ path: treePath })
        .send([{ type: 'Selector' }]);
      expect(res.status).toBe(400);
    });

    it('returns 404 when the target directory does not exist', async () => {
      const res = await request(app())
        .post('/api/tree')
        .query({ path: join(root, 'missing-dir', 'tree.json') })
        .send({ type: 'Selector' });
      expect(res.status).toBe(404);
      expect(res.text).toBe('Path not found');
    });

    it('writes the tree with tab indentation and returns { ok: true }', async () => {
      const tree = { type: 'Selector', label: 'Root', childNodes: [{ type: 'Sequence' }] };
      const res = await request(app()).post('/api/tree').query({ path: treePath }).send(tree);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      const written = readFileSync(treePath, 'utf8');
      expect(written).toBe(JSON.stringify(tree, null, '\t'));
      expect(written).toContain('\n\t"type"');
    });

    it('returns 409 with the default message when onTreeSave returns false', async () => {
      writePlugin('module.exports = { onTreeSave() { return false; } };');
      const before = readFileSync(treePath, 'utf8');
      const res = await request(app())
        .post('/api/tree')
        .query({ path: treePath })
        .send({ type: 'Selector', label: 'x' });

      expect(res.status).toBe(409);
      expect(res.text).toBe('Save was forbidden by tree project plugin');
      expect(readFileSync(treePath, 'utf8')).toBe(before);
    });

    it('returns 409 with the message when onTreeSave returns a string', async () => {
      writePlugin(
        `module.exports = { onTreeSave(ctx) { if (ctx.tree.label === 'forbidden') return 'Root label must not be "forbidden"'; } };`,
      );
      const res = await request(app())
        .post('/api/tree')
        .query({ path: treePath })
        .send({ type: 'Selector', label: 'forbidden' });

      expect(res.status).toBe(409);
      expect(res.text).toBe('Root label must not be "forbidden"');
    });

    it('saves the tree as modified by onTreeSave', async () => {
      writePlugin('module.exports = { onTreeSave(ctx) { ctx.tree.label = "saved"; } };');
      const res = await request(app())
        .post('/api/tree')
        .query({ path: treePath })
        .send({ type: 'Selector' });

      expect(res.status).toBe(200);
      expect(JSON.parse(readFileSync(treePath, 'utf8')).label).toBe('saved');
    });

    it('picks up plugin edits without restarting', async () => {
      writePlugin('module.exports = { onTreeSave() { return "blocked"; } };');
      const application = app();
      const blocked = await request(application)
        .post('/api/tree')
        .query({ path: treePath })
        .send({ type: 'Selector' });
      expect(blocked.status).toBe(409);

      writePlugin('module.exports = { onTreeSave() { return undefined; } };');
      const allowed = await request(application)
        .post('/api/tree')
        .query({ path: treePath })
        .send({ type: 'Selector' });
      expect(allowed.status).toBe(200);
    });

    it('saves normally once the plugin is removed', async () => {
      writePlugin('module.exports = { onTreeSave() { return false; } };');
      removePlugin();
      const res = await request(app())
        .post('/api/tree')
        .query({ path: treePath })
        .send({ type: 'Selector' });
      expect(res.status).toBe(200);
    });
  });

  it('returns 404 for unknown API routes', async () => {
    const res = await request(app()).get('/api/nope');
    expect(res.status).toBe(404);
  });
});
