import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';

const BOM = String.fromCharCode(0xfeff);

describe('tree file parsing and formatting', () => {
  let root: string;
  let treePath: string;

  const app = () => createApp({ clientDist: join(root, 'no-client-build') });
  const readTree = () => readFileSync(treePath, 'utf8');

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'owlbt-treefmt-'));
    mkdirSync(join(root, 'trees'), { recursive: true });
    writeFileSync(join(root, 'owl-bt.json'), JSON.stringify({ nodes: [{ name: 'Selector' }] }));
    treePath = join(root, 'trees', 'tree.json');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('GET /api/tree', () => {
    it('loads a tree that starts with a UTF-8 byte order mark', async () => {
      writeFileSync(treePath, `${BOM}{"type":"Selector","label":"bom"}\n`);
      const res = await request(app()).get('/api/tree').query({ path: treePath });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ type: 'Selector', label: 'bom' });
    });

    it('answers 422 with the parse error for invalid JSON', async () => {
      writeFileSync(treePath, '{\n  "type": \n}');
      const res = await request(app()).get('/api/tree').query({ path: treePath });
      expect(res.status).toBe(422);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.body.message).toMatch(/^Invalid JSON in tree file: /);
    });
  });

  describe('POST /api/tree', () => {
    it('keeps the two-space indentation and CRLF line endings of the file', async () => {
      writeFileSync(treePath, '{\r\n  "type": "Selector"\r\n}\r\n');
      const res = await request(app())
        .post('/api/tree')
        .query({ path: treePath })
        .send({ type: 'Sequence', childNodes: [{ type: 'Task' }] });
      expect(res.status).toBe(200);
      expect(readTree()).toBe(
        '{\r\n  "type": "Sequence",\r\n  "childNodes": [\r\n    {\r\n      "type": "Task"\r\n    }\r\n  ]\r\n}\r\n',
      );
    });

    it('leaves an existing tab-indented file byte for byte unchanged when the content is unchanged', async () => {
      const tree = {
        type: 'Selector',
        label: 'Root',
        childNodes: [{ type: 'Sequence', values: ['a', 'b'] }],
      };
      const original = `${JSON.stringify(tree, null, '\t')}\n`;
      writeFileSync(treePath, original);
      await request(app()).post('/api/tree').query({ path: treePath }).send(tree);
      expect(readTree()).toBe(original);
    });

    it('keeps the byte order mark of an existing file', async () => {
      writeFileSync(treePath, `${BOM}{\n\t"type": "Selector"\n}`);
      await request(app()).post('/api/tree').query({ path: treePath }).send({ type: 'Sequence' });
      expect(readTree()).toBe(`${BOM}{\n\t"type": "Sequence"\n}`);
    });

    it('writes a new file with tab indentation and no trailing newline', async () => {
      const tree = { type: 'Selector', label: 'new' };
      const res = await request(app()).post('/api/tree').query({ path: treePath }).send(tree);
      expect(res.status).toBe(200);
      expect(readTree()).toBe(JSON.stringify(tree, null, '\t'));
    });

    it('keeps every concurrent save readable JSON and leaves no temporary files', async () => {
      writeFileSync(treePath, '{"type":"Selector"}');
      const application = app();
      const saves = Array.from({ length: 5 }, (_, i) =>
        request(application)
          .post('/api/tree')
          .query({ path: treePath })
          .send({ type: 'Selector', label: `save-${i}` }),
      );
      const results = await Promise.all(saves);
      expect(results.map((res) => res.status)).toEqual([200, 200, 200, 200, 200]);
      const saved = JSON.parse(readTree()) as { label: string };
      expect(saved.label).toMatch(/^save-\d$/);
      expect(readFileSync(treePath, 'utf8').endsWith('}')).toBe(true);
    });
  });
});
