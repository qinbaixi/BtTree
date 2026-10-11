import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { detectIndent, formatJsonLike, indentOf, sha256 } from './projectFile';

const PROJECT = {
  types: { key: { type: 'string', pattern: '[a-z]+' } },
  nodes: [{ name: 'Selector', isComposite: true, futureField: { kept: [1, 2] } }],
};

describe('projectFile helpers', () => {
  it('detects tab, two and four space indentation and defaults to four spaces', () => {
    expect(detectIndent('{\n\t"a": 1\n}')).toBe('\t');
    expect(detectIndent('{\n  "a": 1\n}')).toBe(2);
    expect(detectIndent('{\n    "a": 1\n}')).toBe(4);
    expect(detectIndent('{"a":1}')).toBe(4);
    expect(detectIndent('\n\n   "x"')).toBe(3);
  });

  it('keeps indentation, trailing newline and CRLF of the original text', () => {
    expect(formatJsonLike({ a: 1 }, '{\n\t"a": 0\n}\n')).toBe('{\n\t"a": 1\n}\n');
    expect(formatJsonLike({ a: 1 }, '{\n  "a": 0\n}')).toBe('{\n  "a": 1\n}');
    expect(formatJsonLike({ a: 1 }, '{\r\n  "a": 0\r\n}\r\n')).toBe('{\r\n  "a": 1\r\n}\r\n');
  });

  it('keeps short arrays of plain values on one line when the original does', () => {
    const original = '{\n  "values": ["A", "B"],\n  "base": ["X"]\n}\n';
    expect(
      formatJsonLike({ values: ['A', 'B', 'C'], base: ['X'], n: [1, true, null] }, original),
    ).toBe('{\n  "values": ["A", "B", "C"],\n  "base": ["X"],\n  "n": [1, true, null]\n}\n');
    const long = Array.from({ length: 20 }, (_, i) => `value-${i}`);
    expect(formatJsonLike({ values: long }, original)).toContain('"values": [\n');
    expect(formatJsonLike({ values: [{ a: 1 }] }, original)).toContain('"values": [\n');
  });

  it('expands arrays when the original writes them on several lines', () => {
    const original = '{\n    "values": [\n        "A"\n    ]\n}\n';
    expect(formatJsonLike({ values: ['A', 'B'] }, original)).toBe(
      '{\n    "values": [\n        "A",\n        "B"\n    ]\n}\n',
    );
  });

  it('round-trips the sample and template project files unchanged', () => {
    for (const file of ['../../../samples/basic/owl-bt.json', '../templates/owl-bt.json']) {
      const text = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(formatJsonLike(JSON.parse(text), text)).toBe(text);
    }
  });

  it('hashes text with sha256 hex', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('project editing routes', () => {
  let root: string;
  let noProjectDir: string;
  let treePath: string;
  let projectPath: string;

  const app = () => createApp({ clientDist: join(root, 'no-client-build') });
  const readProject = () => readFileSync(projectPath, 'utf8');
  const hashOfDisk = () => sha256(readProject());

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'owlbt-prj-'));
    noProjectDir = mkdtempSync(join(tmpdir(), 'owlbt-noprj-'));
    mkdirSync(join(root, 'trees'), { recursive: true });
    projectPath = join(root, 'owl-bt.json');
    writeFileSync(projectPath, `${JSON.stringify(PROJECT, null, 4)}\n`);
    treePath = join(root, 'trees', 'tree.json');
    writeFileSync(treePath, JSON.stringify({ type: 'Selector' }));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(noProjectDir, { recursive: true, force: true });
  });

  describe('GET /api/project/meta', () => {
    it('returns the project path, the hash and the raw content', async () => {
      const res = await request(app()).get('/api/project/meta').query({ path: treePath });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        path: projectPath,
        hash: hashOfDisk(),
        content: readProject(),
      });
    });

    it('accepts the project file path itself', async () => {
      const res = await request(app()).get('/api/project/meta').query({ path: projectPath });
      expect(res.status).toBe(200);
      expect(res.body.path).toBe(projectPath);
    });

    it('returns 400 for missing or relative paths and 404 without a project', async () => {
      expect((await request(app()).get('/api/project/meta')).status).toBe(400);
      expect((await request(app()).get('/api/project/meta').query({ path: 'x.json' })).status).toBe(
        400,
      );
      mkdirSync(noProjectDir, { recursive: true });
      const res = await request(app())
        .get('/api/project/meta')
        .query({ path: join(noProjectDir, 'x.json') });
      expect(res.status).toBe(404);
      expect(res.text).toBe('No project found');
    });

    it('keeps GET /api/project returning the raw text', async () => {
      const res = await request(app()).get('/api/project').query({ path: treePath });
      expect(res.text).toBe(readProject());
    });
  });

  describe('PUT /api/project', () => {
    const body = (content: unknown, extra: Record<string, unknown> = {}) => ({
      content,
      baseHash: hashOfDisk(),
      ...extra,
    });

    it('writes the content and returns the hash of the new text', async () => {
      const content = { ...PROJECT, nodes: [{ name: 'Sequence', isComposite: true }] };
      const res = await request(app())
        .put('/api/project')
        .query({ path: projectPath })
        .send(body(content));
      expect(res.status).toBe(200);
      expect(readProject()).toBe(`${JSON.stringify(content, null, 4)}\n`);
      expect(res.body).toEqual({ hash: hashOfDisk() });
    });

    it('accepts a tree path inside the project', async () => {
      const res = await request(app())
        .put('/api/project')
        .query({ path: treePath })
        .send(body(PROJECT));
      expect(res.status).toBe(200);
    });

    it('returns 409 with the current hash when the file changed since baseHash', async () => {
      const res = await request(app())
        .put('/api/project')
        .query({ path: projectPath })
        .send({ content: PROJECT, baseHash: 'stale' });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        message: 'Project file changed on disk',
        currentHash: hashOfDisk(),
      });
      expect(readProject()).toBe(`${JSON.stringify(PROJECT, null, 4)}\n`);
    });

    it('writes over a stale hash with force: true', async () => {
      writeFileSync(projectPath, '{"nodes":[]}');
      const content = { nodes: [{ name: 'Forced' }] };
      const res = await request(app())
        .put('/api/project')
        .query({ path: projectPath })
        .send({ content, baseHash: 'stale', force: true });
      expect(res.status).toBe(200);
      expect(JSON.parse(readProject())).toEqual(content);
    });

    it('returns 400 with the message when the content does not compile', async () => {
      const cyclic = {
        services: [
          { name: 'A', base: 'B' },
          { name: 'B', base: 'A' },
        ],
      };
      const res = await request(app())
        .put('/api/project')
        .query({ path: projectPath })
        .send(body(cyclic));
      expect(res.status).toBe(400);
      expect(res.text).toMatch(/Cyclic inheritance/);
      expect(readProject()).toBe(`${JSON.stringify(PROJECT, null, 4)}\n`);
    });

    it('returns 400 for a missing base', async () => {
      const res = await request(app())
        .put('/api/project')
        .query({ path: projectPath })
        .send(body({ nodes: [{ name: 'A', base: 'Gone' }] }));
      expect(res.status).toBe(400);
      expect(res.text).toBe("Missing base type 'Gone' for 'A'");
    });

    it('returns 400 when the body or its fields have the wrong shape', async () => {
      const put = (payload: unknown) =>
        request(app())
          .put('/api/project')
          .query({ path: projectPath })
          .send(payload as object);
      expect((await put(['x'])).status).toBe(400);
      expect((await put({ content: [], baseHash: 'x' })).status).toBe(400);
      expect((await put({ content: { nodes: [] } })).status).toBe(400);
      expect((await put({ content: { nodes: [] }, baseHash: 1 })).status).toBe(400);
    });

    it('returns 415 for non-JSON bodies', async () => {
      const res = await request(app())
        .put('/api/project')
        .query({ path: projectPath })
        .set('Content-Type', 'text/plain')
        .send('{}');
      expect(res.status).toBe(415);
    });

    it('returns 404 when there is no project', async () => {
      mkdirSync(noProjectDir, { recursive: true });
      const res = await request(app())
        .put('/api/project')
        .query({ path: join(noProjectDir, 'x.json') })
        .send({ content: {}, baseHash: 'x' });
      expect(res.status).toBe(404);
      expect(res.text).toBe('No project found');
    });

    it('keeps the two-space indentation of the file', async () => {
      writeFileSync(projectPath, `${JSON.stringify(PROJECT, null, 2)}\n`);
      await request(app())
        .put('/api/project')
        .query({ path: projectPath })
        .send(body({ nodes: [{ name: 'Two' }] }));
      expect(readProject()).toBe('{\n  "nodes": [\n    {\n      "name": "Two"\n    }\n  ]\n}\n');
    });

    it('keeps tab indentation and a missing trailing newline', async () => {
      writeFileSync(projectPath, JSON.stringify(PROJECT, null, '\t'));
      await request(app())
        .put('/api/project')
        .query({ path: projectPath })
        .send(body({ nodes: [{ name: 'Tabs' }] }));
      expect(readProject()).toBe('{\n\t"nodes": [\n\t\t{\n\t\t\t"name": "Tabs"\n\t\t}\n\t]\n}');
    });

    it('preserves unknown fields at every level', async () => {
      const res = await request(app())
        .put('/api/project')
        .query({ path: projectPath })
        .send(
          body({
            nodes: [{ name: 'N', futureField: { kept: [1, 2] } }],
            experimental: { flag: true },
          }),
        );
      expect(res.status).toBe(200);
      const saved = JSON.parse(readProject()) as Record<string, unknown>;
      expect(saved.experimental).toEqual({ flag: true });
      expect((saved.nodes as Array<Record<string, unknown>>)[0].futureField).toEqual({
        kept: [1, 2],
      });
    });
  });
});

describe('formatJsonLike for new and untouched files', () => {
  it('uses the fallback indentation when the original has no indented line', () => {
    expect(formatJsonLike({ a: 1 }, '{"a":0}', '\t')).toBe('{\n\t"a": 1\n}');
    expect(formatJsonLike({ a: 1 }, undefined, '\t')).toBe('{\n\t"a": 1\n}');
    expect(formatJsonLike({ a: 1 }, undefined)).toBe('{\n    "a": 1\n}');
  });

  it('keeps the indentation of an indented original over the fallback', () => {
    expect(formatJsonLike({ a: 1 }, '{\n  "a": 0\n}\n', '\t')).toBe('{\n  "a": 1\n}\n');
  });

  it('reports the indentation of the first indented line, or none', () => {
    expect(indentOf('{"a":1}')).toBeUndefined();
    expect(indentOf('{\n\t"a": 1\n}')).toBe('\t');
  });
});

describe('concurrent project saves', () => {
  it('lets only one of two saves with the same baseHash succeed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'owlbt-race-'));
    try {
      const projectPath = join(root, 'owl-bt.json');
      writeFileSync(projectPath, `${JSON.stringify(PROJECT, null, 4)}\n`);
      const baseHash = sha256(readFileSync(projectPath, 'utf8'));
      const application = createApp({ clientDist: join(root, 'no-client-build') });
      const save = (name: string) =>
        request(application)
          .put('/api/project')
          .query({ path: projectPath })
          .send({ content: { nodes: [{ name }] }, baseHash });

      const [first, second] = await Promise.all([save('First'), save('Second')]);

      expect([first.status, second.status].sort()).toEqual([200, 409]);
      const winner = first.status === 200 ? 'First' : 'Second';
      const saved = JSON.parse(readFileSync(projectPath, 'utf8')) as {
        nodes: Array<{ name: string }>;
      };
      expect(saved.nodes[0].name).toBe(winner);
      expect(readdirSync(root)).toEqual(['owl-bt.json']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
