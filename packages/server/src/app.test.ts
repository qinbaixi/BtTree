import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, DEFAULT_CLIENT_DIST, resolveClientDist } from './app';

describe('createApp', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'owlbt-app-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('responds to the health check', async () => {
    const res = await request(createApp({ clientDist: join(dir, 'missing') })).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('serves the client build and falls back to index.html for non-API GET requests', async () => {
    writeFileSync(join(dir, 'index.html'), '<html>spa-shell</html>');
    writeFileSync(join(dir, 'app.js'), 'console.log("asset");');
    const app = createApp({ clientDist: dir });

    const page = await request(app).get('/tree').query({ path: 'x' });
    expect(page.status).toBe(200);
    expect(page.text).toContain('spa-shell');

    const asset = await request(app).get('/app.js');
    expect(asset.status).toBe(200);
    expect(asset.text).toContain('asset');
  });

  it('does not fall back to index.html for unknown API routes', async () => {
    writeFileSync(join(dir, 'index.html'), '<html>spa-shell</html>');
    const res = await request(createApp({ clientDist: dir })).get('/api/unknown');
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('spa-shell');
  });

  it('does not serve a client when the build is missing', async () => {
    const res = await request(createApp({ clientDist: join(dir, 'missing') })).get('/tree');
    expect(res.status).toBe(404);
  });
});

describe('resolveClientDist', () => {
  const saved = process.env.OWLBT_CLIENT_DIST;

  afterEach(() => {
    if (saved === undefined) {
      delete process.env.OWLBT_CLIENT_DIST;
    } else {
      process.env.OWLBT_CLIENT_DIST = saved;
    }
  });

  it('prefers the clientDist option over the environment', () => {
    process.env.OWLBT_CLIENT_DIST = '/from/env';
    expect(resolveClientDist({ clientDist: '/from/option' })).toBe(resolve('/from/option'));
  });

  it('uses OWLBT_CLIENT_DIST when set', () => {
    process.env.OWLBT_CLIENT_DIST = '/from/env';
    expect(resolveClientDist()).toBe(resolve('/from/env'));
  });

  it('falls back to the monorepo client build in the source layout', () => {
    delete process.env.OWLBT_CLIENT_DIST;
    expect(resolveClientDist()).toBe(DEFAULT_CLIENT_DIST);
  });
});
