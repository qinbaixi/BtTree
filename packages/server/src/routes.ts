import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { ErrorRequestHandler } from 'express';
import express, { Router } from 'express';
import type { ProjectFile, TreeNodeJson } from '@owlbt/shared';
import { HttpError, isErrno } from './errors';
import {
  createPicker,
  DialogBusyError,
  DialogUnsupportedError,
  type PickKind,
  type Picker,
} from './picker';
import { exportProject, exportTree, parseExportFormats } from './export';
import { getProject, isPathInDir, type PluginContext, type Project } from './project';
import {
  initProject,
  loadWorkspace,
  readTemplate,
  withJsonExtension,
  writeNewFile,
} from './workspace';

export { HttpError } from './errors';

export interface RouterOptions {
  /** Native dialog runner. Defaults to a picker for the current platform. */
  picker?: Picker;
}

function requireAbsolutePath(raw: unknown, name = 'path'): string {
  if (typeof raw !== 'string' || raw === '') {
    throw new HttpError(400, `Missing ${name}`);
  }
  if (!isAbsolute(raw)) {
    throw new HttpError(400, `${name[0].toUpperCase()}${name.slice(1)} must be absolute`);
  }
  return raw;
}

function objectBody(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new HttpError(400, 'Body must be a JSON object');
  }
  return body as Record<string, unknown>;
}

async function requireProjectFor(treePath: string): Promise<Project> {
  const project = await getProject(treePath);
  if (!project || !isPathInDir(treePath, project.dir)) {
    throw new HttpError(403, 'Path must be in project');
  }
  return project;
}

/** Optional starting folder for a dialog. A file is replaced by its folder; anything unusable is ignored. */
async function resolveInitialDir(raw: unknown): Promise<string | undefined> {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  const path = requireAbsolutePath(raw, 'initialDir');
  try {
    const info = await stat(path);
    if (info.isDirectory()) {
      return resolve(path);
    }
    if (info.isFile()) {
      return dirname(resolve(path));
    }
  } catch {
    // Missing starting folder: let the dialog pick its default.
  }
  return undefined;
}

function buildContext(project: Project, treePath: string, tree: TreeNodeJson): PluginContext {
  return {
    tree,
    path: treePath,
    project: JSON.parse(project.content) as ProjectFile,
    projectPath: project.path,
  };
}

export function createApiRouter(options: RouterOptions = {}): Router {
  const router = Router();
  const picker = options.picker ?? createPicker();

  router.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  router.get('/project', async (req, res) => {
    const treePath = requireAbsolutePath(req.query.path);
    let project: Project | undefined;
    try {
      project = await getProject(treePath);
    } catch (err) {
      if (!isErrno(err, 'ENOENT')) {
        throw err;
      }
    }
    if (!project) {
      throw new HttpError(404, 'No project found');
    }
    res.type('application/json').send(project.content);
  });

  router.get('/workspace', async (req, res) => {
    const dir = requireAbsolutePath(req.query.dir, 'dir');
    res.json(await loadWorkspace(dir));
  });

  // Media type check for writes, before the body is parsed.
  router.use((req, res, next) => {
    if ((req.method === 'POST' || req.method === 'PUT') && !req.is('application/json')) {
      res.status(415).type('text/plain').send('Content-Type must be application/json');
      return;
    }
    next();
  });
  router.use(express.json({ limit: '50mb' }));

  router.get('/tree', async (req, res) => {
    const treePath = requireAbsolutePath(req.query.path);
    const project = await requireProjectFor(treePath);

    let raw: string;
    try {
      raw = await readFile(treePath, 'utf8');
    } catch (err) {
      if (isErrno(err, 'ENOENT')) {
        throw new HttpError(404, 'Path not found');
      }
      throw err;
    }

    let tree = JSON.parse(raw) as TreeNodeJson;
    if (project.plugin?.onTreeLoad) {
      const ctx = buildContext(project, treePath, tree);
      await project.plugin.onTreeLoad(ctx);
      tree = ctx.tree;
    }
    res.json(tree);
  });

  router.post('/tree', async (req, res) => {
    const treePath = requireAbsolutePath(req.query.path);
    const project = await requireProjectFor(treePath);

    const body: unknown = req.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new HttpError(400, 'Tree must be a JSON object');
    }

    let tree = body as TreeNodeJson;
    if (project.plugin?.onTreeSave) {
      const ctx = buildContext(project, treePath, tree);
      const result = await project.plugin.onTreeSave(ctx);
      if (result === false) {
        throw new HttpError(409, 'Save was forbidden by tree project plugin');
      }
      if (typeof result === 'string') {
        throw new HttpError(409, result);
      }
      tree = ctx.tree;
    }

    try {
      await writeFile(treePath, JSON.stringify(tree, null, '\t'), 'utf8');
    } catch (err) {
      if (isErrno(err, 'ENOENT')) {
        throw new HttpError(404, 'Path not found');
      }
      throw err;
    }
    res.json({ ok: true });
  });

  router.post('/dialog/pick', async (req, res) => {
    const body = objectBody(req.body ?? {});
    const kind = body.kind;
    if (kind !== 'folder' && kind !== 'file') {
      throw new HttpError(400, 'kind must be "folder" or "file"');
    }
    const initialDir = await resolveInitialDir(body.initialDir);
    try {
      const result = await picker.pick(kind as PickKind, initialDir);
      res.json(result);
    } catch (err) {
      if (err instanceof DialogUnsupportedError) {
        res.status(501).json({ message: err.message });
        return;
      }
      if (err instanceof DialogBusyError) {
        throw new HttpError(409, err.message);
      }
      throw err;
    }
  });

  router.post('/project/init', async (req, res) => {
    const body = objectBody(req.body);
    const dir = requireAbsolutePath(body.dir, 'dir');
    res.json(await initProject(dir));
  });

  router.post('/tree/create', async (req, res) => {
    const body = objectBody(req.body);
    const treePath = withJsonExtension(resolve(requireAbsolutePath(body.path, 'path')));
    await requireProjectFor(treePath);

    await mkdir(dirname(treePath), { recursive: true });
    const created = await writeNewFile(treePath, await readTemplate('tree.json'));
    if (!created) {
      throw new HttpError(409, 'File already exists');
    }
    res.json({ path: treePath });
  });

  router.post('/export', async (req, res) => {
    const body = objectBody(req.body);
    const treePath = requireAbsolutePath(body.path, 'path');
    const formats = parseExportFormats(body.formats);
    res.json(await exportTree(treePath, formats));
  });

  router.post('/export/batch', async (req, res) => {
    const body = objectBody(req.body);
    const dir = requireAbsolutePath(body.dir, 'dir');
    const formats = parseExportFormats(body.formats);
    res.json(await exportProject(dir, formats));
  });

  return router;
}

/** Turns thrown errors into plain text responses. Never lets an error crash the server. */
export const apiErrorHandler: ErrorRequestHandler = (err: unknown, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  let status = 500;
  if (err instanceof HttpError) {
    status = err.status;
  } else if (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { status?: unknown }).status === 'number'
  ) {
    // body-parser errors (malformed JSON 400, too large 413, ...)
    const s = (err as { status: number }).status;
    if (s >= 400 && s < 600) {
      status = s;
    }
  }
  if (status >= 500) {
    console.error(err);
  }
  const message = err instanceof Error ? err.message : String(err);
  res.status(status).type('text/plain').send(message);
};
