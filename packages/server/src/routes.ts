import { mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { ErrorRequestHandler, Request, Response } from 'express';
import express, { Router } from 'express';
import { compileProject, type ProjectFile, type TreeNodeJson } from '@owlbt/shared';
import { HttpError, isErrno } from './errors';
import { withFileLock, writeFileAtomic } from './fileLock';
import {
  createPicker,
  DialogBusyError,
  DialogUnsupportedError,
  type PickKind,
  type Picker,
} from './picker';
import { exportProject, exportTree, parseExportFormats } from './export';
import { formatJsonLike, sha256 } from './projectFile';
import { runScenarioTests, ScenarioConfigError } from './scenarioTests';
import {
  getProject,
  isPathInDir,
  PLUGIN_FILE_NAME,
  type PluginContext,
  type PluginStatus,
  type Project,
  type ProjectOptions,
} from './project';
import { revoke, trust } from './pluginTrust';
import { registerReferenceRoutes } from './referenceRoutes';
import { formatTreeText, parseTreeText } from './treeFile';
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
  /** Runs owl-bt.js without the trust check. */
  trustAllPlugins?: boolean;
}

/** Response header of GET /api/tree when the project has a plugin: trusted, changed or untrusted. */
export const PLUGIN_HEADER = 'X-Owlbt-Plugin';

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

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The project that applies to a path (the project file itself or a tree in the project). 404 when none. */
async function loadProjectOr404(path: string, options: ProjectOptions = {}): Promise<Project> {
  let project: Project | undefined;
  try {
    project = await getProject(path, options);
  } catch (err) {
    if (!isErrno(err, 'ENOENT')) {
      throw err;
    }
  }
  if (!project) {
    throw new HttpError(404, 'No project found');
  }
  return project;
}

async function requireProjectFor(treePath: string, options: ProjectOptions = {}): Promise<Project> {
  const project = await getProject(treePath, options);
  if (!project || !isPathInDir(treePath, project.dir)) {
    throw new HttpError(403, 'Path must be in project');
  }
  return project;
}

/** Header value for the plugin state: `trusted`, `changed` (trusted before, edited since) or `untrusted`. */
function pluginHeaderValue(status: PluginStatus): string {
  if (status.trusted) {
    return 'trusted';
  }
  return status.changed === true ? 'changed' : 'untrusted';
}

/** Body of the /api/plugin routes. `pluginPath` is null when the project has no plugin. */
function pluginResponse(project: Project): {
  pluginPath: string | null;
  trusted?: boolean;
  changed?: boolean;
} {
  const status = project.pluginStatus;
  if (!status) {
    return { pluginPath: null };
  }
  return { pluginPath: status.path, trusted: status.trusted, changed: status.changed === true };
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
  const projectOptions: ProjectOptions = { trustAllPlugins: options.trustAllPlugins };

  router.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  router.get('/project', async (req, res) => {
    const project = await loadProjectOr404(requireAbsolutePath(req.query.path), projectOptions);
    res.type('application/json').send(project.content);
  });

  router.get('/project/meta', async (req, res) => {
    const project = await loadProjectOr404(requireAbsolutePath(req.query.path), projectOptions);
    res.json({ path: project.path, hash: sha256(project.content), content: project.content });
  });

  router.get('/workspace', async (req, res) => {
    const dir = requireAbsolutePath(req.query.dir, 'dir');
    res.json(await loadWorkspace(dir));
  });

  // Plugin trust state of the project that applies to a tree or project path.
  router.get('/plugin', async (req, res) => {
    const project = await loadProjectOr404(requireAbsolutePath(req.query.path), projectOptions);
    res.json(pluginResponse(project));
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

  /**
   * Saves owl-bt.json. Rejected (400) when the content does not compile. Rejected (409, with the
   * current hash) when the file changed since baseHash was read, unless force is true. The check and
   * the write run under the file lock, so two saves with the same baseHash cannot both succeed.
   */
  router.put('/project', async (req, res) => {
    const body = objectBody(req.body);
    const project = await loadProjectOr404(requireAbsolutePath(req.query.path), projectOptions);

    const content = body.content;
    if (typeof content !== 'object' || content === null || Array.isArray(content)) {
      throw new HttpError(400, 'Content must be a JSON object');
    }
    if (typeof body.baseHash !== 'string') {
      throw new HttpError(400, 'baseHash must be a string');
    }
    try {
      compileProject(content as ProjectFile);
    } catch (err) {
      throw new HttpError(400, messageOf(err));
    }

    const outcome = await withFileLock(project.path, async () => {
      let current: string;
      try {
        current = await readFile(project.path, 'utf8');
      } catch (err) {
        if (isErrno(err, 'ENOENT')) {
          throw new HttpError(404, 'No project found');
        }
        throw err;
      }
      const currentHash = sha256(current);
      if (body.force !== true && body.baseHash !== currentHash) {
        return { conflict: true as const, currentHash };
      }
      const text = formatJsonLike(content, current);
      await writeFileAtomic(project.path, text);
      return { conflict: false as const, hash: sha256(text) };
    });

    if (outcome.conflict) {
      res.status(409).json({
        message: 'Project file changed on disk',
        currentHash: outcome.currentHash,
      });
      return;
    }
    res.json({ hash: outcome.hash });
  });

  router.get('/tree', async (req, res) => {
    const treePath = requireAbsolutePath(req.query.path);
    const project = await requireProjectFor(treePath, projectOptions);

    let raw: string;
    try {
      raw = await readFile(treePath, 'utf8');
    } catch (err) {
      if (isErrno(err, 'ENOENT')) {
        throw new HttpError(404, 'Path not found');
      }
      throw err;
    }

    let tree: TreeNodeJson;
    try {
      tree = parseTreeText(raw);
    } catch (err) {
      res.status(422).json({ message: `Invalid JSON in tree file: ${messageOf(err)}` });
      return;
    }

    if (project.pluginStatus) {
      res.setHeader(PLUGIN_HEADER, pluginHeaderValue(project.pluginStatus));
    }
    if (project.plugin?.onTreeLoad) {
      const ctx = buildContext(project, treePath, tree);
      await project.plugin.onTreeLoad(ctx);
      tree = ctx.tree;
    }
    res.json(tree);
  });

  router.post('/tree', async (req, res) => {
    const treePath = requireAbsolutePath(req.query.path);
    const project = await requireProjectFor(treePath, projectOptions);

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

    await withFileLock(treePath, async () => {
      let original: string | undefined;
      try {
        original = await readFile(treePath, 'utf8');
      } catch (err) {
        if (!isErrno(err, 'ENOENT')) {
          throw err;
        }
      }
      // A new file gets tab indentation. An existing file keeps its indentation, line endings and BOM.
      try {
        await writeFileAtomic(treePath, formatTreeText(tree, original));
      } catch (err) {
        if (isErrno(err, 'ENOENT')) {
          throw new HttpError(404, 'Path not found');
        }
        throw err;
      }
    });
    res.json({ ok: true });
  });

  /** Trust decisions. The body names a path in the project; the project's plugin is the subject. */
  const pluginDecision = (apply: (pluginPath: string) => Promise<void>) => {
    return async (req: Request, res: Response): Promise<void> => {
      const body = objectBody(req.body);
      const project = await loadProjectOr404(
        requireAbsolutePath(body.path, 'path'),
        projectOptions,
      );
      if (!project.pluginStatus) {
        throw new HttpError(404, 'No plugin found');
      }
      try {
        await apply(join(project.dir, PLUGIN_FILE_NAME));
      } catch (err) {
        if (isErrno(err, 'ENOENT')) {
          throw new HttpError(404, 'No plugin found');
        }
        throw err;
      }
      res.json(pluginResponse(await loadProjectOr404(project.path, projectOptions)));
    };
  };
  router.post(
    '/plugin/trust',
    pluginDecision((pluginPath) => trust(pluginPath)),
  );
  router.post(
    '/plugin/revoke',
    pluginDecision((pluginPath) => revoke(pluginPath)),
  );

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
    await requireProjectFor(treePath, projectOptions);

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

  registerReferenceRoutes(router);

  router.post('/export/batch', async (req, res) => {
    const body = objectBody(req.body);
    const dir = requireAbsolutePath(body.dir, 'dir');
    const formats = parseExportFormats(body.formats);
    res.json(await exportProject(dir, formats));
  });

  router.post('/scenario-tests', async (req, res) => {
    const body = objectBody(req.body);
    const path = requireAbsolutePath(body.path, 'path');
    const stringList = (raw: unknown, name: string): string[] | undefined => {
      if (raw === undefined) return undefined;
      if (!Array.isArray(raw) || raw.some((item) => typeof item !== 'string')) {
        throw new HttpError(400, `${name} must be an array of strings`);
      }
      return raw as string[];
    };
    const project = body.project;
    if (
      project !== undefined &&
      (typeof project !== 'object' || project === null || Array.isArray(project))
    ) {
      throw new HttpError(400, 'project must be an object');
    }
    try {
      res.json(
        await runScenarioTests(path, {
          trees: stringList(body.trees, 'trees'),
          scenarios: stringList(body.scenarios, 'scenarios'),
          project: project as ProjectFile | undefined,
        }),
      );
    } catch (err) {
      if (err instanceof ScenarioConfigError) {
        throw new HttpError(400, err.message);
      }
      throw err;
    }
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
