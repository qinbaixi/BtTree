import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app';
import {
  createPicker,
  DialogUnsupportedError,
  type PickKind,
  type Picker,
  type RunCommand,
} from './picker';
import { readTemplate } from './workspace';

const PROJECT_JSON = JSON.stringify({ nodes: [{ name: 'Selector', isComposite: true }] });

describe('workspace, project init and tree creation routes', () => {
  let root: string;
  let outside: string;
  let clientDist: string;

  const app = (picker?: Picker) => createApp({ clientDist, picker: picker ?? { pick: vi.fn() } });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'owlbt-wsroutes-'));
    outside = mkdtempSync(join(tmpdir(), 'owlbt-outside-'));
    clientDist = join(root, 'no-client-build');
    writeFileSync(join(root, 'owl-bt.json'), PROJECT_JSON);
    mkdirSync(join(root, 'trees'));
    writeFileSync(join(root, 'trees', 'demo.json'), '{"type":"Selector"}');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  describe('GET /api/workspace', () => {
    it('returns 400 when dir is missing or relative', async () => {
      const missing = await request(app()).get('/api/workspace');
      expect(missing.status).toBe(400);
      expect(missing.text).toBe('Missing dir');

      const relative = await request(app()).get('/api/workspace').query({ dir: 'trees' });
      expect(relative.status).toBe(400);
      expect(relative.text).toBe('Dir must be absolute');
    });

    it('returns 404 when the folder does not exist', async () => {
      const res = await request(app())
        .get('/api/workspace')
        .query({ dir: join(root, 'missing') });
      expect(res.status).toBe(404);
    });

    it('lists the trees of a folder with the project information', async () => {
      const res = await request(app())
        .get('/api/workspace')
        .query({ dir: join(root, 'trees') });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        dir: join(root, 'trees'),
        projectPath: join(root, 'owl-bt.json'),
        projectDir: root,
        trees: [{ path: join(root, 'trees', 'demo.json'), relPath: 'trees/demo.json' }],
        truncated: false,
      });
    });

    it('uses the folder of a file given as dir', async () => {
      const res = await request(app())
        .get('/api/workspace')
        .query({ dir: join(root, 'trees', 'demo.json') });

      expect(res.status).toBe(200);
      expect(res.body.dir).toBe(join(root, 'trees'));
    });
  });

  describe('POST /api/project/init', () => {
    it('writes owl-bt.json and the example tree and returns the workspace', async () => {
      const dir = join(outside, 'fresh');
      mkdirSync(dir);

      const res = await request(app()).post('/api/project/init').send({ dir });

      expect(res.status).toBe(200);
      expect(readFileSync(join(dir, 'owl-bt.json'), 'utf8')).toBe(
        await readTemplate('owl-bt.json'),
      );
      expect(existsSync(join(dir, 'trees', 'example.json'))).toBe(true);
      expect(res.body.projectPath).toBe(join(dir, 'owl-bt.json'));
      expect(res.body.trees.map((t: { relPath: string }) => t.relPath)).toEqual([
        'trees/example.json',
      ]);
    });

    it('returns 409 when the folder is already inside a project', async () => {
      const res = await request(app())
        .post('/api/project/init')
        .send({ dir: join(root, 'trees') });
      expect(res.status).toBe(409);
      expect(res.text).toBe('Directory is already inside a project');
    });

    it('returns 404 when the folder does not exist', async () => {
      const res = await request(app())
        .post('/api/project/init')
        .send({ dir: join(outside, 'nope') });
      expect(res.status).toBe(404);
    });

    it('returns 400 for a relative or missing dir', async () => {
      expect((await request(app()).post('/api/project/init').send({ dir: 'x' })).status).toBe(400);
      expect((await request(app()).post('/api/project/init').send({})).status).toBe(400);
    });

    it('returns 415 for a non-JSON body', async () => {
      const res = await request(app()).post('/api/project/init').type('text/plain').send('dir');
      expect(res.status).toBe(415);
    });
  });

  describe('POST /api/tree/create', () => {
    it('creates the tree from the template, appending .json and making folders', async () => {
      const path = join(root, 'trees', 'nested', 'new-tree');

      const res = await request(app()).post('/api/tree/create').send({ path });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ path: `${path}.json` });
      expect(readFileSync(`${path}.json`, 'utf8')).toBe(await readTemplate('tree.json'));
    });

    it('keeps an existing .json extension', async () => {
      const path = join(root, 'trees', 'x.json');
      const res = await request(app()).post('/api/tree/create').send({ path });
      expect(res.status).toBe(200);
      expect(res.body.path).toBe(path);
    });

    it('returns 409 when the file already exists', async () => {
      const res = await request(app())
        .post('/api/tree/create')
        .send({ path: join(root, 'trees', 'demo.json') });
      expect(res.status).toBe(409);
      expect(res.text).toBe('File already exists');
      expect(readFileSync(join(root, 'trees', 'demo.json'), 'utf8')).toBe('{"type":"Selector"}');
    });

    it('returns 403 when the path is outside the project', async () => {
      const res = await request(app())
        .post('/api/tree/create')
        .send({ path: join(outside, 'tree.json') });
      expect(res.status).toBe(403);
      expect(res.text).toBe('Path must be in project');
      expect(existsSync(join(outside, 'tree.json'))).toBe(false);
    });

    it('returns 400 for a relative or missing path', async () => {
      expect((await request(app()).post('/api/tree/create').send({ path: 'tree' })).status).toBe(
        400,
      );
      const missing = await request(app()).post('/api/tree/create').send({});
      expect(missing.status).toBe(400);
      expect(missing.text).toBe('Missing path');
    });
  });

  describe('POST /api/dialog/pick', () => {
    function fakePicker(pick: Picker['pick']): Picker {
      return { pick: vi.fn(pick) };
    }

    it('returns 400 for an unknown kind', async () => {
      const res = await request(app(fakePicker(async () => ({ cancelled: true }))))
        .post('/api/dialog/pick')
        .send({ kind: 'folder-ish' });
      expect(res.status).toBe(400);
      expect(res.text).toBe('kind must be "folder" or "file"');
    });

    it('returns 400 when initialDir is relative', async () => {
      const res = await request(app(fakePicker(async () => ({ cancelled: true }))))
        .post('/api/dialog/pick')
        .send({ kind: 'folder', initialDir: 'trees' });
      expect(res.status).toBe(400);
    });

    it('returns the selected path and passes kind and initialDir to the picker', async () => {
      const picker = fakePicker(async (kind: PickKind) => ({ path: `${kind}-result` }));
      const res = await request(app(picker))
        .post('/api/dialog/pick')
        .send({ kind: 'file', initialDir: join(root, 'trees') });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ path: 'file-result' });
      expect(picker.pick).toHaveBeenCalledWith('file', join(root, 'trees'));
    });

    it('uses the folder of a file given as initialDir', async () => {
      const picker = fakePicker(async () => ({ cancelled: true }));
      const res = await request(app(picker))
        .post('/api/dialog/pick')
        .send({ kind: 'file', initialDir: join(root, 'trees', 'demo.json') });

      expect(res.body).toEqual({ cancelled: true });
      expect(picker.pick).toHaveBeenCalledWith('file', join(root, 'trees'));
    });

    it('ignores an initialDir that does not exist', async () => {
      const picker = fakePicker(async () => ({ cancelled: true }));
      await request(app(picker))
        .post('/api/dialog/pick')
        .send({ kind: 'folder', initialDir: join(root, 'missing') });
      expect(picker.pick).toHaveBeenCalledWith('folder', undefined);
    });

    it('returns 501 with a message when no dialog is available', async () => {
      const picker = fakePicker(async () => {
        throw new DialogUnsupportedError('No dialog here');
      });
      const res = await request(app(picker)).post('/api/dialog/pick').send({ kind: 'folder' });

      expect(res.status).toBe(501);
      expect(res.body).toEqual({ message: 'No dialog here' });
    });

    it('returns 409 while another dialog is open', async () => {
      let markStarted: () => void = () => {};
      const started = new Promise<void>((resolve) => (markStarted = resolve));
      let release: () => void = () => {};
      const run: RunCommand = () => {
        markStarted();
        return new Promise((resolve) => {
          release = () => resolve({ stdout: '', stderr: '', exitCode: 0, timedOut: false });
        });
      };
      const application = app(createPicker({ platform: 'win32', run }));

      const firstDone = request(application)
        .post('/api/dialog/pick')
        .send({ kind: 'folder' })
        .then((res) => res);
      await started;

      const second = await request(application).post('/api/dialog/pick').send({ kind: 'file' });
      expect(second.status).toBe(409);
      expect(second.text).toBe('A dialog is already open');

      release();
      expect((await firstDone).body).toEqual({ cancelled: true });
    });
  });
});
