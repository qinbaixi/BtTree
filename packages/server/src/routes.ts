import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { ErrorRequestHandler } from 'express';
import express, { Router } from 'express';
import type { ProjectFile, TreeNodeJson } from '@owlbt/shared';
import { getProject, isPathInDir, type PluginContext, type Project } from './project';

/** Error with an HTTP status; rendered as text by {@link apiErrorHandler}. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

function isErrno(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === code;
}

function requireAbsolutePath(raw: unknown): string {
  if (typeof raw !== 'string' || raw === '') {
    throw new HttpError(400, 'Missing path');
  }
  if (!isAbsolute(raw)) {
    throw new HttpError(400, 'Path must be absolute');
  }
  return raw;
}

async function requireProjectFor(treePath: string): Promise<Project> {
  const project = await getProject(treePath);
  if (!project || !isPathInDir(treePath, project.dir)) {
    throw new HttpError(403, 'Path must be in project');
  }
  return project;
}

function buildContext(project: Project, treePath: string, tree: TreeNodeJson): PluginContext {
  return {
    tree,
    path: treePath,
    project: JSON.parse(project.content) as ProjectFile,
    projectPath: project.path,
  };
}

export function createApiRouter(): Router {
  const router = Router();

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
