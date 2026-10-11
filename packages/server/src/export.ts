import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import {
  buildExportModel,
  createIdGen,
  csharpClassName,
  goNamePrefix,
  nodeFromJson,
  parseAndCompileProject,
  parseCsNamespace,
  parseGoPackage,
  sanitizeModuleName,
  toCSharp,
  toErlang,
  toGo,
  toLua,
  toTypeScript,
  type CompiledProject,
  type ProjectFile,
  type TreeNodeJson,
} from '@owlbt/shared';
import { HttpError, isErrno } from './errors';
import { findProjectFile } from './project';
import { loadWorkspace, type WorkspaceTree } from './workspace';

export const EXPORT_FORMATS = ['erlang', 'lua', 'ts', 'cs', 'go'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

const FORMAT_DEFAULTS: Record<ExportFormat, { outDir: string; extension: string }> = {
  erlang: { outDir: 'export/erlang', extension: '.erl' },
  lua: { outDir: 'export/lua', extension: '.lua' },
  ts: { outDir: 'export/ts', extension: '.ts' },
  cs: { outDir: 'export/cs', extension: '.cs' },
  go: { outDir: 'export/go', extension: '.go' },
};

export interface ExportedFile {
  format: ExportFormat;
  /** Absolute path of the written file. */
  path: string;
}

export interface ExportTreeResult {
  /** Absolute path of the tree file. */
  treePath: string;
  files: ExportedFile[];
  warnings: string[];
  /** Set when the tree could not be exported. Files written before the failure stay listed. */
  error?: string;
}

export interface ExportOptions {
  /** Output folder for every format (the CLI `--out` option). Relative paths resolve against the process folder. */
  outDir?: string;
}

export interface ExportProjectResult {
  projectDir: string;
  /** True when the workspace listing stopped at its tree limit. */
  truncated: boolean;
  results: Array<ExportTreeResult & { relPath: string }>;
}

/** Trees exported at the same time by exportProject. */
export const EXPORT_CONCURRENCY = 4;

/**
 * The project file as the exporter needs it: parsed and compiled once. Export never runs the
 * project plugin (owl-bt.js), so it is not loaded.
 */
interface ExportProject {
  dir: string;
  file: ProjectFile;
  compiled?: CompiledProject;
  /** Set when owl-bt.json does not compile. */
  error?: string;
}

/** Cache of loaded projects by owl-bt.json path, shared by the trees of one batch. */
type ProjectCache = Map<string, Promise<ExportProject>>;

async function readExportProject(path: string): Promise<ExportProject> {
  const content = await readFile(path, 'utf8');
  const compiled = parseAndCompileProject(content);
  if (!compiled.project) {
    return { dir: dirname(path), file: {}, error: compiled.error ?? 'unknown error' };
  }
  return {
    dir: dirname(path),
    file: JSON.parse(content) as ProjectFile,
    compiled: compiled.project,
  };
}

/** The project that applies to a tree, or undefined when there is none. */
async function loadExportProject(
  treePath: string,
  cache?: ProjectCache,
): Promise<ExportProject | undefined> {
  const path = await findProjectFile(treePath);
  if (!path) {
    return undefined;
  }
  if (!cache) {
    return readExportProject(path);
  }
  let pending = cache.get(path);
  if (!pending) {
    pending = readExportProject(path);
    cache.set(path, pending);
    // A failed read (e.g. too many open files) is not cached: the next tree tries again.
    pending.catch(() => cache.delete(path));
  }
  return pending;
}

/** Where one format of a tree is written, from the project's export settings. */
function outputFile(
  project: ExportProject,
  treePath: string,
  format: ExportFormat,
  options: ExportOptions,
): { path: string; baseName: string } {
  const defaults = FORMAT_DEFAULTS[format];
  const config = project.file.export?.[format] ?? {};
  const treeName = basename(treePath).replace(/\.json$/i, '');
  const outDir = resolve(project.dir, options.outDir ?? config.outDir ?? defaults.outDir);
  const fileName = (config.fileName ?? '{name}').replace(/\{name\}/g, treeName);
  const withExtension = fileName.toLowerCase().endsWith(defaults.extension)
    ? fileName
    : `${fileName}${defaults.extension}`;
  return {
    path: resolve(outDir, withExtension),
    baseName: basename(withExtension, defaults.extension),
  };
}

/**
 * Splits the trees of a batch into groups that can run at the same time: trees that write the same
 * output file (e.g. trees/a.json and trees/sub/a.json both write a.lua) share a group and run one
 * after the other in listing order, so the last one in the listing wins as before and two writes
 * never interleave. Groups are ordered by their first tree.
 */
async function writeGroups(
  trees: WorkspaceTree[],
  formats: ExportFormat[],
  options: ExportOptions,
  cache: ProjectCache,
): Promise<number[][]> {
  // Union-find over trees: two trees are linked when they write the same file.
  const parent = trees.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) {
      root = parent[root];
    }
    parent[index] = root;
    return root;
  };
  const firstWriter = new Map<string, number>();
  for (const [index, tree] of trees.entries()) {
    let project: ExportProject | undefined;
    try {
      project = await loadExportProject(tree.path, cache);
    } catch {
      continue; // Reported by the tree's own export.
    }
    if (!project) {
      continue;
    }
    for (const format of formats) {
      const { path } = outputFile(project, tree.path, format, options);
      const key = process.platform === 'win32' ? path.toLowerCase() : path;
      const other = firstWriter.get(key);
      if (other === undefined) {
        firstWriter.set(key, index);
      } else {
        parent[find(index)] = find(other);
      }
    }
  }
  const groups = new Map<number, number[]>();
  for (let index = 0; index < trees.length; index++) {
    const root = find(index);
    const group = groups.get(root);
    if (group) {
      group.push(index);
    } else {
      groups.set(root, [index]);
    }
  }
  return [...groups.values()];
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isExportFormat(value: unknown): value is ExportFormat {
  return (EXPORT_FORMATS as readonly unknown[]).includes(value);
}

/** Validates the `formats` of a request: a non-empty list of known formats, without duplicates. */
export function parseExportFormats(raw: unknown): ExportFormat[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new HttpError(400, 'formats must be a non-empty array');
  }
  const formats: ExportFormat[] = [];
  for (const item of raw) {
    if (!isExportFormat(item)) {
      throw new HttpError(400, `Unknown export format: ${String(item)}`);
    }
    if (!formats.includes(item)) {
      formats.push(item);
    }
  }
  return formats;
}

/**
 * Exports one tree to the requested formats. Writes files into the configured output folders
 * (relative to the project directory). Throws HttpError 404 when there is no project or no file;
 * problems with the tree or the output are returned in `error`.
 */
export async function exportTree(
  treePath: string,
  formats: ExportFormat[],
  options: ExportOptions = {},
): Promise<ExportTreeResult> {
  return exportTreeIn(treePath, formats, options);
}

async function exportTreeIn(
  treePath: string,
  formats: ExportFormat[],
  options: ExportOptions,
  cache?: ProjectCache,
): Promise<ExportTreeResult> {
  const project = await loadExportProject(treePath, cache);
  if (!project) {
    throw new HttpError(404, 'No project found');
  }

  const result: ExportTreeResult = { treePath, files: [], warnings: [] };

  let raw: string;
  try {
    raw = await readFile(treePath, 'utf8');
  } catch (err) {
    if (isErrno(err, 'ENOENT')) {
      throw new HttpError(404, 'Path not found');
    }
    return { ...result, error: `Cannot read tree: ${messageOf(err)}` };
  }

  let json: TreeNodeJson;
  try {
    json = JSON.parse(raw) as TreeNodeJson;
  } catch (err) {
    return { ...result, error: `Invalid tree file: ${messageOf(err)}` };
  }

  if (!project.compiled) {
    return { ...result, error: `Invalid project file: ${project.error ?? 'unknown error'}` };
  }

  let model: ReturnType<typeof buildExportModel>;
  try {
    model = buildExportModel(nodeFromJson(json, createIdGen()), project.compiled);
  } catch (err) {
    return { ...result, error: messageOf(err) };
  }
  result.warnings = model.warnings;

  const projectFile = project.file;
  const sourcePath = relative(project.dir, treePath).split(sep).join('/');

  for (const format of formats) {
    const config = projectFile.export?.[format] ?? {};
    const { path, baseName } = outputFile(project, treePath, format, options);
    let content: string;
    if (format === 'erlang') {
      content = toErlang(model, { module: sanitizeModuleName(baseName), sourcePath });
    } else if (format === 'lua') {
      content = toLua(model, { sourcePath });
    } else if (format === 'ts') {
      content = toTypeScript(model, { sourcePath });
    } else if (format === 'go') {
      const goPackage = parseGoPackage(config.package);
      if (goPackage.warning !== undefined) {
        result.warnings.push(goPackage.warning);
      }
      content = toGo(model, {
        sourcePath,
        packageName: goPackage.package,
        namePrefix: goNamePrefix(baseName),
      });
    } else {
      const namespace = parseCsNamespace(config.namespace);
      if (namespace.warning !== undefined) {
        result.warnings.push(namespace.warning);
      }
      content = toCSharp(model, {
        sourcePath,
        className: csharpClassName(baseName),
        namespace: namespace.namespace,
      });
    }

    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, 'utf8');
    } catch (err) {
      return { ...result, error: `Cannot write ${path}: ${messageOf(err)}` };
    }
    result.files.push({ format, path });
  }

  return result;
}

/**
 * Exports every tree of the project that contains `dir`. A failing tree is reported in its result
 * and does not stop the others. Throws HttpError 404 when `dir` is not inside a project.
 */
export async function exportProject(
  dir: string,
  formats: ExportFormat[],
  options: ExportOptions = {},
): Promise<ExportProjectResult> {
  const workspace = await loadWorkspace(dir);
  if (workspace.projectDir === undefined) {
    throw new HttpError(404, 'No project found');
  }

  // owl-bt.json is read and compiled once per batch; trees are exported a few at a time so file
  // I/O overlaps. Results keep the order of the workspace listing.
  const cache: ProjectCache = new Map();
  const { trees } = workspace;
  const groups = await writeGroups(trees, formats, options, cache);
  const results: ExportProjectResult['results'] = new Array(trees.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < groups.length) {
      for (const index of groups[next++]) {
        const tree = trees[index];
        try {
          results[index] = {
            relPath: tree.relPath,
            ...(await exportTreeIn(tree.path, formats, options, cache)),
          };
        } catch (err) {
          results[index] = {
            relPath: tree.relPath,
            treePath: tree.path,
            files: [],
            warnings: [],
            error: messageOf(err),
          };
        }
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(EXPORT_CONCURRENCY, groups.length) }, () => worker()),
  );
  return { projectDir: workspace.projectDir, truncated: workspace.truncated, results };
}
