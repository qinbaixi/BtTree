import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { listSamples, openSample, samplesDir, samplesHome } from './samples';

describe('built-in samples', () => {
  let root: string;
  let source: string;
  let home: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'owlbt-samples-'));
    source = join(root, 'source');
    home = join(root, 'home');
    mkdirSync(join(source, 'demo', 'trees'), { recursive: true });
    writeFileSync(join(source, 'demo', 'owl-bt.json'), '{"nodes":[{"name":"Root"}]}');
    writeFileSync(join(source, 'demo', 'trees', 'main.json'), '{"type":"Root"}');
    mkdirSync(join(source, 'not-a-project'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('lists the folders with a project and their trees', async () => {
    expect(await listSamples(source)).toEqual([{ id: 'demo', trees: ['trees/main.json'] }]);
    expect(await listSamples(join(root, 'missing'))).toEqual([]);
  });

  it('copies a sample once and keeps edits while the bundled content is the same', async () => {
    const opened = await openSample('demo', source, home);
    const treePath = join(home, 'demo', 'trees', 'main.json');
    expect(opened.dir).toBe(join(home, 'demo'));
    expect(opened.projectPath).toBe(join(home, 'demo', 'owl-bt.json'));
    expect(opened.trees).toEqual([{ path: treePath, relPath: 'trees/main.json' }]);

    writeFileSync(treePath, '{"type":"Root","label":"edited"}');
    await openSample('demo', source, home);
    expect(readFileSync(treePath, 'utf8')).toContain('edited');
  });

  it('replaces the copy when the bundled sample changed (an app update)', async () => {
    await openSample('demo', source, home);
    writeFileSync(join(home, 'demo', 'stale.json'), '{}');
    writeFileSync(join(source, 'demo', 'trees', 'main.json'), '{"type":"Root","label":"v2"}');

    await openSample('demo', source, home);
    expect(readFileSync(join(home, 'demo', 'trees', 'main.json'), 'utf8')).toContain('v2');
    expect(existsSync(join(home, 'demo', 'stale.json'))).toBe(false);
  });

  it('rejects unknown and malformed ids', async () => {
    await expect(openSample('nope', source, home)).rejects.toMatchObject({ status: 404 });
    await expect(openSample('../demo', source, home)).rejects.toMatchObject({ status: 400 });
    await expect(openSample('not-a-project', source, home)).rejects.toMatchObject({ status: 404 });
  });

  it('reads the folders from the environment', () => {
    expect(samplesDir({ OWLBT_SAMPLES_DIR: source })).toBe(source);
    expect(samplesHome({ OWLBT_SAMPLES_HOME: home })).toBe(home);
  });

  it('serves the repository samples over HTTP', async () => {
    const previous = { dir: process.env.OWLBT_SAMPLES_DIR, home: process.env.OWLBT_SAMPLES_HOME };
    delete process.env.OWLBT_SAMPLES_DIR;
    process.env.OWLBT_SAMPLES_HOME = home;
    try {
      const app = createApp({ clientDist: join(root, 'no-client-build') });
      const list = await request(app).get('/api/samples');
      expect(list.status).toBe(200);
      const ids = (list.body.samples as Array<{ id: string; trees: string[] }>).map((s) => s.id);
      expect(ids).toEqual(expect.arrayContaining(['basic', 'simulation']));
      const simulation = list.body.samples.find((s: { id: string }) => s.id === 'simulation');
      expect(simulation.trees).toContain('trees/ai/fighter.json');

      const opened = await request(app).post('/api/samples/open').send({ id: 'simulation' });
      expect(opened.status).toBe(200);
      expect(opened.body.dir).toBe(join(home, 'simulation'));
      expect(existsSync(join(home, 'simulation', 'trees', 'ai', 'fighter.json'))).toBe(true);

      const missing = await request(app).post('/api/samples/open').send({});
      expect(missing.status).toBe(400);
    } finally {
      if (previous.dir === undefined) delete process.env.OWLBT_SAMPLES_DIR;
      else process.env.OWLBT_SAMPLES_DIR = previous.dir;
      if (previous.home === undefined) delete process.env.OWLBT_SAMPLES_HOME;
      else process.env.OWLBT_SAMPLES_HOME = previous.home;
    }
  });
});
