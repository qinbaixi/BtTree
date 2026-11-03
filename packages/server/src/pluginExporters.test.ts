import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { exportProject, exportTree } from './export';
import { collectPluginExporters } from './pluginExporters';
import { TRUST_FILE_ENV } from './pluginTrust';

const PROJECT = {
  nodes: [
    { name: 'Selector', isComposite: true },
    { name: 'Wait', properties: [{ name: 'duration', type: 'number', default: 100 }] },
  ],
};

const TREE = { type: 'Selector', label: 'Root', childNodes: [{ type: 'Wait' }] };

/** Writes one line per entry: `<id> <kind> <comment>`. */
const PLUGIN = `
module.exports = {
  exporters: {
    txt: {
      label: 'Plain text',
      extension: 'txt',
      render(model, ctx) {
        const lines = model.entries.map((e) => e.id + ' ' + e.kind + ' ' + e.comment);
        if (ctx.config.header) lines.unshift(ctx.config.header);
        ctx.warn('hello');
        return ['# ' + ctx.sourcePath + ' -> ' + ctx.baseName, ...lines].join('\\n') + '\\n';
      },
    },
    json2: {
      outDir: 'out/json',
      async render(model, ctx) {
        return JSON.stringify({ root: model.rootId, tree: ctx.tree.type });
      },
    },
    broken: { render() { return 42; } },
    throws: { render() { throw new Error('boom'); } },
  },
};
`;

describe('plugin exporters', () => {
  let root: string;
  let trustDir: string;
  let savedTrustFile: string | undefined;
  let treePath: string;

  const writePlugin = (source: string) => writeFileSync(join(root, 'owl-bt.js'), source);

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'owlbt-plugin-export-'));
    trustDir = mkdtempSync(join(tmpdir(), 'owlbt-plugin-export-trust-'));
    savedTrustFile = process.env[TRUST_FILE_ENV];
    process.env[TRUST_FILE_ENV] = join(trustDir, 'trusted-plugins.json');
    mkdirSync(join(root, 'trees'), { recursive: true });
    writeFileSync(join(root, 'owl-bt.json'), JSON.stringify(PROJECT));
    treePath = join(root, 'trees', 'mon.json');
    writeFileSync(treePath, JSON.stringify(TREE));
    writePlugin(PLUGIN);
  });

  afterEach(() => {
    if (savedTrustFile === undefined) {
      delete process.env[TRUST_FILE_ENV];
    } else {
      process.env[TRUST_FILE_ENV] = savedTrustFile;
    }
    rmSync(root, { recursive: true, force: true });
    rmSync(trustDir, { recursive: true, force: true });
  });

  it('writes plugin formats to export/<format> with the exporter extension by default', async () => {
    const result = await exportTree(treePath, ['txt', 'lua'], { trustAllPlugins: true });
    expect(result.error).toBeUndefined();
    expect(result.files).toEqual([
      { format: 'txt', path: join(root, 'export', 'txt', 'mon.txt') },
      { format: 'lua', path: join(root, 'export', 'lua', 'mon.lua') },
    ]);
    expect(result.warnings).toEqual(['txt: hello']);
    expect(readFileSync(result.files[0].path, 'utf8')).toBe(
      '# trees/mon.json -> mon\n1 node Selector - Root\n2 node Wait\n',
    );
  });

  it('uses the exporter outDir, and owl-bt.json export.<format> settings over it', async () => {
    const first = await exportTree(treePath, ['json2'], { trustAllPlugins: true });
    expect(first.files).toEqual([
      { format: 'json2', path: join(root, 'out', 'json', 'mon.json2') },
    ]);
    expect(JSON.parse(readFileSync(first.files[0].path, 'utf8'))).toEqual({
      root: 1,
      tree: 'Selector',
    });

    writeFileSync(
      join(root, 'owl-bt.json'),
      JSON.stringify({
        ...PROJECT,
        export: { txt: { outDir: 'custom', fileName: 'bt_{name}', header: 'HEAD' } },
      }),
    );
    const second = await exportTree(treePath, ['txt'], { trustAllPlugins: true });
    expect(second.files).toEqual([{ format: 'txt', path: join(root, 'custom', 'bt_mon.txt') }]);
    expect(readFileSync(second.files[0].path, 'utf8').split('\n')[1]).toBe('HEAD');

    const forced = await exportTree(treePath, ['txt'], {
      trustAllPlugins: true,
      outDir: join(root, 'cli'),
    });
    expect(forced.files[0].path).toBe(join(root, 'cli', 'bt_mon.txt'));
  });

  it('reports exporters that fail or return something other than text', async () => {
    const broken = await exportTree(treePath, ['broken'], { trustAllPlugins: true });
    expect(broken.error).toBe(
      'Exporter broken failed: render must return a string or a Buffer, got number',
    );
    const thrown = await exportTree(treePath, ['throws'], { trustAllPlugins: true });
    expect(thrown.error).toBe('Exporter throws failed: boom');
  });

  it('rejects unknown formats and does not run an untrusted plugin', async () => {
    await expect(exportTree(treePath, ['nope'], { trustAllPlugins: true })).rejects.toThrow(
      'Unknown export format: nope',
    );
    writePlugin(`require('fs').writeFileSync(${JSON.stringify(join(root, 'ran'))}, 'x');${PLUGIN}`);
    await expect(exportTree(treePath, ['txt'])).rejects.toThrow(/owl-bt\.js is not trusted/);
    expect(existsSync(join(root, 'ran'))).toBe(false);
    // Built-in formats never load the plugin.
    const lua = await exportTree(treePath, ['lua']);
    expect(lua.error).toBeUndefined();
    expect(existsSync(join(root, 'ran'))).toBe(false);
  });

  it('exports every tree of a project with plugin formats', async () => {
    writeFileSync(join(root, 'trees', 'other.json'), JSON.stringify(TREE));
    const batch = await exportProject(root, ['txt'], { trustAllPlugins: true });
    expect(batch.results.map((item) => item.files)).toEqual([
      [{ format: 'txt', path: join(root, 'export', 'txt', 'mon.txt') }],
      [{ format: 'txt', path: join(root, 'export', 'txt', 'other.txt') }],
    ]);
    await expect(exportProject(root, ['nope'], { trustAllPlugins: true })).rejects.toThrow(
      'Unknown export format: nope',
    );
  });

  it('skips invalid exporter entries with a warning', () => {
    const { exporters, warnings } = collectPluginExporters({
      exporters: {
        lua: { render: () => '' },
        'bad name': { render: () => '' },
        norender: {},
        badext: { extension: '../x', render: () => '' },
        ok: { render: () => '' },
      },
    });
    expect([...exporters.keys()]).toEqual(['ok']);
    expect(exporters.get('ok')).toMatchObject({
      label: 'ok',
      extension: '.ok',
      outDir: 'export/ok',
    });
    expect(warnings).toHaveLength(4);
  });

  describe('routes', () => {
    const app = (trustAllPlugins?: boolean) =>
      createApp({ clientDist: join(root, 'no-client-build'), trustAllPlugins });

    it('GET /api/exporters lists the formats of a trusted plugin', async () => {
      const res = await request(app(true)).get('/api/exporters').query({ path: treePath });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        exporters: [
          { format: 'txt', label: 'Plain text', extension: '.txt', outDir: 'export/txt' },
          { format: 'json2', label: 'json2', extension: '.json2', outDir: 'out/json' },
          { format: 'broken', label: 'broken', extension: '.broken', outDir: 'export/broken' },
          { format: 'throws', label: 'throws', extension: '.throws', outDir: 'export/throws' },
        ],
        warnings: [],
      });
    });

    it('GET /api/exporters hides the formats of an untrusted plugin', async () => {
      const res = await request(app()).get('/api/exporters').query({ path: treePath });
      expect(res.status).toBe(200);
      expect(res.body.exporters).toEqual([]);
      expect(res.body.error).toMatch(/not trusted/);
    });

    it('GET /api/exporters is empty without a plugin', async () => {
      rmSync(join(root, 'owl-bt.js'));
      const res = await request(app()).get('/api/exporters').query({ path: treePath });
      expect(res.body).toEqual({ exporters: [], warnings: [] });
    });

    it('POST /api/export runs plugin formats', async () => {
      const res = await request(app(true))
        .post('/api/export')
        .send({ path: treePath, formats: ['txt'] });
      expect(res.status).toBe(200);
      expect(res.body.files).toEqual([
        { format: 'txt', path: join(root, 'export', 'txt', 'mon.txt') },
      ]);
      const untrusted = await request(app())
        .post('/api/export')
        .send({ path: treePath, formats: ['txt'] });
      expect(untrusted.status).toBe(400);
    });
  });
});
