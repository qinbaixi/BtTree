import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';

const PROJECT = {
  types: { blackboardKey: { type: 'string' } },
  nodes: [
    { name: 'Sequence', isComposite: true },
    { name: 'Walk', properties: [{ name: 'Target', type: 'blackboardKey' }] },
  ],
  decorators: [{ name: 'IsSet', properties: [{ name: 'Field', type: 'blackboardKey' }] }],
  blackboard: [{ name: 'Spot', type: 'string' }],
};

const BOM = String.fromCharCode(0xfeff);

describe('reference routes', () => {
  let root: string;
  let aPath: string;
  let bPath: string;

  const app = () => createApp({ clientDist: join(root, 'no-client-build'), trustAllPlugins: true });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'owlbt-refs-'));
    mkdirSync(join(root, 'trees', 'sub'), { recursive: true });
    writeFileSync(join(root, 'owl-bt.json'), JSON.stringify(PROJECT, null, 2));
    aPath = join(root, 'trees', 'a.json');
    bPath = join(root, 'trees', 'sub', 'b.json');
    // a.json: 2-space indentation, CRLF line endings and a BOM.
    const a = {
      type: 'Sequence',
      label: 'Root',
      extra: 1,
      childNodes: [
        {
          type: 'MoveTo',
          label: 'Go',
          properties: [{ name: 'Target', value: 'Waypoint' }],
          decorators: [{ type: 'IsSet', properties: [{ name: 'Field', value: 'Waypoint' }] }],
        },
      ],
    };
    writeFileSync(aPath, `${BOM}${JSON.stringify(a, null, 2).replace(/\n/g, '\r\n')}\r\n`);
    writeFileSync(bPath, JSON.stringify({ type: 'MoveTo' }, null, '\t'));
    writeFileSync(join(root, 'trees', 'broken.json'), '{ not json');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('GET /api/usages', () => {
    it('lists the files and items that use a type', async () => {
      const res = await request(app())
        .get('/api/usages')
        .query({ path: join(root, 'owl-bt.json'), kind: 'node', name: 'MoveTo' });
      expect(res.status).toBe(200);
      expect(res.body.files).toEqual([
        {
          path: aPath,
          relPath: 'trees/a.json',
          usages: [
            {
              nodePath: [0],
              itemKind: 'node',
              type: 'MoveTo',
              label: 'Go',
              location: 'Root › Go',
            },
          ],
        },
        {
          path: bPath,
          relPath: 'trees/sub/b.json',
          usages: [{ nodePath: [], itemKind: 'node', type: 'MoveTo', location: 'MoveTo' }],
        },
      ]);
      expect(res.body.truncated).toBe(false);
    });

    it('lists blackboard key usages from a tree path', async () => {
      // Walk is the renamed MoveTo; a.json still says MoveTo, so only the decorator matches.
      const res = await request(app())
        .get('/api/usages')
        .query({ path: bPath, kind: 'blackboardKey', name: 'Waypoint' });
      expect(res.status).toBe(200);
      expect(res.body.files).toHaveLength(1);
      expect(res.body.files[0].usages).toMatchObject([
        { itemKind: 'decorator', itemIndex: 0, property: 'Field' },
      ]);
    });

    it('validates the query', async () => {
      const bad = await request(app())
        .get('/api/usages')
        .query({ path: aPath, kind: 'thing', name: 'X' });
      expect(bad.status).toBe(400);
      const missing = await request(app()).get('/api/usages').query({ path: aPath, kind: 'node' });
      expect(missing.status).toBe(400);
      const relative = await request(app())
        .get('/api/usages')
        .query({ path: 'trees/a.json', kind: 'node', name: 'X' });
      expect(relative.status).toBe(400);
    });

    it('returns 404 outside a project', async () => {
      const other = mkdtempSync(join(tmpdir(), 'owlbt-refs-none-'));
      try {
        const res = await request(app())
          .get('/api/usages')
          .query({ path: other, kind: 'node', name: 'X' });
        expect(res.status).toBe(404);
      } finally {
        rmSync(other, { recursive: true, force: true });
      }
    });
  });

  describe('POST /api/references/rename', () => {
    const renames = [
      { kind: 'node', from: 'MoveTo', to: 'Walk' },
      { kind: 'blackboardKey', from: 'Waypoint', to: 'Spot' },
    ];

    it('counts the changes in a dry run without writing', async () => {
      const before = readFileSync(aPath, 'utf8');
      const res = await request(app())
        .post('/api/references/rename')
        .send({ path: join(root, 'owl-bt.json'), renames, dryRun: true });
      expect(res.status).toBe(200);
      expect(res.body.dryRun).toBe(true);
      expect(res.body.changed).toEqual([
        { path: aPath, relPath: 'trees/a.json', count: 3 },
        { path: bPath, relPath: 'trees/sub/b.json', count: 1 },
      ]);
      // Files that are not trees (broken.json) are not scanned.
      expect(res.body.errors).toEqual([]);
      expect(readFileSync(aPath, 'utf8')).toBe(before);
    });

    it('rewrites the trees keeping BOM, indentation and line endings', async () => {
      const res = await request(app())
        .post('/api/references/rename')
        .send({ path: aPath, renames, skip: [bPath] });
      expect(res.status).toBe(200);
      expect(res.body.changed[1]).toMatchObject({ path: bPath, skipped: true });

      const text = readFileSync(aPath, 'utf8');
      expect(text.startsWith(BOM)).toBe(true);
      expect(text).toContain('\r\n  "type": "Sequence"');
      expect(text.endsWith('\r\n')).toBe(true);
      const json = JSON.parse(text.slice(1)) as {
        extra: number;
        childNodes: Array<{
          type: string;
          properties: unknown;
          decorators: Array<{ properties: unknown }>;
        }>;
      };
      expect(json.extra).toBe(1);
      expect(json.childNodes[0].type).toBe('Walk');
      expect(json.childNodes[0].properties).toEqual([{ name: 'Target', value: 'Spot' }]);
      expect(json.childNodes[0].decorators[0].properties).toEqual([
        { name: 'Field', value: 'Spot' },
      ]);
      // Skipped: unchanged.
      expect(JSON.parse(readFileSync(bPath, 'utf8'))).toEqual({ type: 'MoveTo' });
    });

    it('rejects malformed renames', async () => {
      const res = await request(app())
        .post('/api/references/rename')
        .send({ path: aPath, renames: [{ kind: 'node', from: '' }] });
      expect(res.status).toBe(400);
      const skip = await request(app())
        .post('/api/references/rename')
        .send({ path: aPath, renames: [], skip: 'x' });
      expect(skip.status).toBe(400);
    });

    it('refuses key renames when the project does not compile', async () => {
      writeFileSync(
        join(root, 'owl-bt.json'),
        JSON.stringify({ nodes: [{ name: 'A', base: 'B' }] }),
      );
      const res = await request(app())
        .post('/api/references/rename')
        .send({ path: aPath, renames: [{ kind: 'blackboardKey', from: 'A', to: 'B' }] });
      expect(res.status).toBe(400);
    });
  });
});
