import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { TRUST_FILE_ENV } from './pluginTrust';

const PROJECT_JSON = JSON.stringify({ nodes: [{ name: 'Selector', isComposite: true }] });
const LOAD_PLUGIN = `module.exports = { onTreeLoad(ctx) { ctx.tree.label = 'ran'; } };`;
const SAVE_PLUGIN = `module.exports = { onTreeSave() { return 'blocked by plugin'; } };`;

describe('plugin trust routes', () => {
  let root: string;
  let noProjectDir: string;
  let trustDir: string;
  let savedTrustFile: string | undefined;
  let treePath: string;
  let pluginPath: string;

  const app = (extra: { trustAllPlugins?: boolean } = {}) =>
    createApp({ clientDist: join(root, 'no-client-build'), ...extra });
  const writePlugin = (source: string) => writeFileSync(pluginPath, source);

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'owlbt-plugin-'));
    noProjectDir = mkdtempSync(join(tmpdir(), 'owlbt-plugin-none-'));
    trustDir = mkdtempSync(join(tmpdir(), 'owlbt-plugin-trust-'));
    savedTrustFile = process.env[TRUST_FILE_ENV];
    process.env[TRUST_FILE_ENV] = join(trustDir, 'trusted-plugins.json');
    mkdirSync(join(root, 'trees'), { recursive: true });
    writeFileSync(join(root, 'owl-bt.json'), PROJECT_JSON);
    treePath = join(root, 'trees', 'tree.json');
    writeFileSync(treePath, JSON.stringify({ type: 'Selector' }));
    pluginPath = join(root, 'owl-bt.js');
  });

  afterEach(() => {
    if (savedTrustFile === undefined) {
      delete process.env[TRUST_FILE_ENV];
    } else {
      process.env[TRUST_FILE_ENV] = savedTrustFile;
    }
    rmSync(root, { recursive: true, force: true });
    rmSync(noProjectDir, { recursive: true, force: true });
    rmSync(trustDir, { recursive: true, force: true });
  });

  const trustBody = (path: string) => ({ path });

  describe('untrusted plugins', () => {
    it('does not run an untrusted plugin on load and says so in the header', async () => {
      writePlugin(LOAD_PLUGIN);
      const res = await request(app()).get('/api/tree').query({ path: treePath });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ type: 'Selector' });
      expect(res.headers['x-owlbt-plugin']).toBe('untrusted');
    });

    it('does not run an untrusted plugin on save', async () => {
      writePlugin(SAVE_PLUGIN);
      const res = await request(app())
        .post('/api/tree')
        .query({ path: treePath })
        .send({ type: 'Selector', label: 'saved' });
      expect(res.status).toBe(200);
      expect(JSON.parse(readFileSync(treePath, 'utf8')).label).toBe('saved');
    });

    it('reports the plugin state from GET /api/plugin', async () => {
      writePlugin(LOAD_PLUGIN);
      const res = await request(app()).get('/api/plugin').query({ path: treePath });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ pluginPath, trusted: false, changed: false });
    });

    it('reports a project without a plugin as pluginPath null and sends no header', async () => {
      const res = await request(app()).get('/api/plugin').query({ path: treePath });
      expect(res.body).toEqual({ pluginPath: null });
      const tree = await request(app()).get('/api/tree').query({ path: treePath });
      expect(tree.headers['x-owlbt-plugin']).toBeUndefined();
    });

    it('answers 404 for paths outside any project', async () => {
      const res = await request(app())
        .get('/api/plugin')
        .query({ path: join(noProjectDir, 'x.json') });
      expect(res.status).toBe(404);
      expect(res.text).toBe('No project found');
    });

    it('treats a corrupt trust file as nothing trusted', async () => {
      writePlugin(LOAD_PLUGIN);
      writeFileSync(process.env[TRUST_FILE_ENV] as string, '{ broken');
      const res = await request(app()).get('/api/tree').query({ path: treePath });
      expect(res.body).toEqual({ type: 'Selector' });
      expect(res.headers['x-owlbt-plugin']).toBe('untrusted');
    });
  });

  describe('POST /api/plugin/trust', () => {
    it('trusts the plugin so it runs on load, and reports trusted', async () => {
      writePlugin(LOAD_PLUGIN);
      const application = app();
      const trusted = await request(application)
        .post('/api/plugin/trust')
        .send(trustBody(treePath));
      expect(trusted.status).toBe(200);
      expect(trusted.body).toEqual({ pluginPath, trusted: true, changed: false });

      const res = await request(application).get('/api/tree').query({ path: treePath });
      expect(res.body.label).toBe('ran');
      expect(res.headers['x-owlbt-plugin']).toBe('trusted');
    });

    it('accepts the project file path too', async () => {
      writePlugin(LOAD_PLUGIN);
      const res = await request(app())
        .post('/api/plugin/trust')
        .send(trustBody(join(root, 'owl-bt.json')));
      expect(res.body.trusted).toBe(true);
    });

    it('applies the trusted plugin to saves', async () => {
      writePlugin(SAVE_PLUGIN);
      const application = app();
      await request(application).post('/api/plugin/trust').send(trustBody(treePath));
      const res = await request(application)
        .post('/api/tree')
        .query({ path: treePath })
        .send({ type: 'Selector' });
      expect(res.status).toBe(409);
      expect(res.text).toBe('blocked by plugin');
    });

    it('turns trusted plugins into changed ones when their content changes', async () => {
      writePlugin(LOAD_PLUGIN);
      const application = app();
      await request(application).post('/api/plugin/trust').send(trustBody(treePath));

      writePlugin(`${LOAD_PLUGIN}\n// changed`);
      const tree = await request(application).get('/api/tree').query({ path: treePath });
      expect(tree.body).toEqual({ type: 'Selector' });
      expect(tree.headers['x-owlbt-plugin']).toBe('changed');

      const state = await request(application).get('/api/plugin').query({ path: treePath });
      expect(state.body).toEqual({ pluginPath, trusted: false, changed: true });
    });

    it('trusts the new content after a change when asked again', async () => {
      writePlugin(LOAD_PLUGIN);
      const application = app();
      await request(application).post('/api/plugin/trust').send(trustBody(treePath));
      writePlugin(`${LOAD_PLUGIN}\n// changed`);

      const again = await request(application).post('/api/plugin/trust').send(trustBody(treePath));
      expect(again.body).toEqual({ pluginPath, trusted: true, changed: false });
    });

    it('answers 404 when the project has no plugin', async () => {
      const res = await request(app()).post('/api/plugin/trust').send(trustBody(treePath));
      expect(res.status).toBe(404);
      expect(res.text).toBe('No plugin found');
    });

    it('answers 404 when the path is not in a project', async () => {
      const res = await request(app())
        .post('/api/plugin/trust')
        .send(trustBody(join(noProjectDir, 'x.json')));
      expect(res.status).toBe(404);
      expect(res.text).toBe('No project found');
    });

    it('answers 400 for a relative path', async () => {
      writePlugin(LOAD_PLUGIN);
      const res = await request(app()).post('/api/plugin/trust').send(trustBody('trees/tree.json'));
      expect(res.status).toBe(400);
    });

    it('is refused for a cross-origin request', async () => {
      writePlugin(LOAD_PLUGIN);
      const res = await request(app())
        .post('/api/plugin/trust')
        .set('Origin', 'http://evil.example')
        .send(trustBody(treePath));
      expect(res.status).toBe(403);
      expect(res.text).toBe('Forbidden origin');
    });
  });

  describe('POST /api/plugin/revoke', () => {
    it('removes the trust so the plugin stops running', async () => {
      writePlugin(LOAD_PLUGIN);
      const application = app();
      await request(application).post('/api/plugin/trust').send(trustBody(treePath));

      const revoked = await request(application)
        .post('/api/plugin/revoke')
        .send(trustBody(treePath));
      expect(revoked.body).toEqual({ pluginPath, trusted: false, changed: false });

      const tree = await request(application).get('/api/tree').query({ path: treePath });
      expect(tree.body).toEqual({ type: 'Selector' });
      expect(tree.headers['x-owlbt-plugin']).toBe('untrusted');
    });

    it('answers 404 when the project has no plugin', async () => {
      const res = await request(app()).post('/api/plugin/revoke').send(trustBody(treePath));
      expect(res.status).toBe(404);
    });
  });

  describe('trustAllPlugins', () => {
    it('runs the plugin without a trust entry and reports it trusted', async () => {
      writePlugin(LOAD_PLUGIN);
      const application = app({ trustAllPlugins: true });
      const res = await request(application).get('/api/tree').query({ path: treePath });
      expect(res.body.label).toBe('ran');
      expect(res.headers['x-owlbt-plugin']).toBe('trusted');
    });
  });
});
