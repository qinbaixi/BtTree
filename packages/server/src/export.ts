import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import {
  buildExportModel,
  collectSubtreeRefsJson,
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
  type ExportModel,
  type FormatExportJson,
  type ProjectFile,
  type SubtreeExportMode,
  type SubtreeLibrary,
  type TreeNodeJson,
} from '@owlbt/shared';
import { HttpError, isErrno } from './errors';
import {
  BUILTIN_EXPORT_FORMATS,
  collectPluginExporters,
  isBuiltinExportFormat,
  isPluginFormatName,
  type BuiltinExportFormat,
  type ResolvedPluginExporter,
} from './pluginExporters';
import { findProjectFile, getProject, PROJECT_FILE_NAME } from './project';
import { loadSubtreeLibrary, treeRefOf, type SubtreeFileCache } from './subtrees';
import { loadWorkspace, type WorkspaceTree } from './workspace';

/** Built-in formats. Projects can add more with `exporters` in owl-bt.js. */
export const EXPORT_FORMATS = BUILTIN_EXPORT_FORMATS;
/** A built-in format or the name of a plugin exporter. */
export type ExportFormat = string;

const FORMAT_DEFAULTS: Record<BuiltinExportFormat, { outDir: string; extension: string }> = {
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
  /** Runs owl-bt.js exporters without the trust check (the --trust-plugins flag). */
  trustAllPlugins?: boolean;
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
 * The project file as the exporter needs it: parsed and compiled once. The project plugin
 * (owl-bt.js) is only loaded when a plugin format is requested, and only when it is trusted.
 */
interface ExportProject {
  dir: string;
  file: ProjectFile;
  compiled?: CompiledProject;
  /** Set when owl-bt.json does not compile. */
  error?: string;
  /** Exporters of owl-bt.js (empty when the plugin was not loaded). */
  exporters: Map<string, ResolvedPluginExporter>;
  /** Problems with the `exporters` of owl-bt.js. */
  pluginWarnings: string[];
  /** Why plugin formats are unavailable (untrusted or broken owl-bt.js). */
  pluginError?: string;
}

/** How the project plugin is loaded for an export. */
interface PluginLoad {
  load: boolean;
  trustAllPlugins?: boolean;
}

function needsPlugin(formats: ExportFormat[]): boolean {
  return formats.some((format) => !isBuiltinExportFormat(format));
}

/** Cache of loaded projects by owl-bt.json path, shared by the trees of one batch. */
type ProjectCache = Map<string, Promise<ExportProject>>;

/** `export.subtrees` of the project: 'reference' unless set to 'inline'; anything else warns. */
export function subtreeExportMode(file: ProjectFile): {
  mode: SubtreeExportMode;
  warning?: string;
} {
  const value: unknown = file.export?.subtrees;
  if (value === undefined || value === 'reference' || value === 'inline') {
    return { mode: value ?? 'reference' };
  }
  return {
    mode: 'reference',
    warning: `Unknown export.subtrees value ${JSON.stringify(value)}; using "reference"`,
  };
}

/** Loads the exporters of owl-bt.js next to owl-bt.json, when it exists and is trusted. */
export async function loadPluginExporters(
  projectPath: string,
  trustAllPlugins?: boolean,
): Promise<Pick<ExportProject, 'exporters' | 'pluginWarnings' | 'pluginError'>> {
  let project: Awaited<ReturnType<typeof getProject>>;
  try {
    project = await getProject(projectPath, { trustAllPlugins });
  } catch (err) {
    return {
      exporters: new Map(),
      pluginWarnings: [],
      pluginError: `owl-bt.js failed to load: ${messageOf(err)}`,
    };
  }
  if (project?.pluginStatus && !project.pluginStatus.trusted) {
    return {
      exporters: new Map(),
      pluginWarnings: [],
      pluginError:
        'the project plugin (owl-bt.js, exporters/) is not trusted; trust it in the editor or pass --trust-plugins to use its exporters',
    };
  }
  const { exporters, warnings } = collectPluginExporters(project?.plugin);
  return { exporters, pluginWarnings: [...(project?.pluginWarnings ?? []), ...warnings] };
}

async function readExportProject(path: string, plugin: PluginLoad): Promise<ExportProject> {
  const content = await readFile(path, 'utf8');
  const compiled = parseAndCompileProject(content);
  const pluginPart = plugin.load
    ? await loadPluginExporters(path, plugin.trustAllPlugins)
    : { exporters: new Map<string, ResolvedPluginExporter>(), pluginWarnings: [] };
  if (!compiled.project) {
    return {
      dir: dirname(path),
      file: {},
      error: compiled.error ?? 'unknown error',
      ...pluginPart,
    };
  }
  return {
    dir: dirname(path),
    file: JSON.parse(content) as ProjectFile,
    compiled: compiled.project,
    ...pluginPart,
  };
}

/** The project that applies to a tree, or undefined when there is none. */
async function loadExportProject(
  treePath: string,
  plugin: PluginLoad,
  cache?: ProjectCache,
): Promise<ExportProject | undefined> {
  const path = await findProjectFile(treePath);
  if (!path) {
    return undefined;
  }
  if (!cache) {
    return readExportProject(path, plugin);
  }
  let pending = cache.get(path);
  if (!pending) {
    pending = readExportProject(path, plugin);
    cache.set(path, pending);
    // A failed read (e.g. too many open files) is not cached: the next tree tries again.
    pending.catch(() => cache.delete(path));
  }
  return pending;
}

/** `export.<format>` of owl-bt.json, or an empty object. */
function formatConfig(file: ProjectFile, format: ExportFormat): FormatExportJson {
  const value: unknown = (file.export as Record<string, unknown> | undefined)?.[format];
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as FormatExportJson)
    : {};
}

/** Where one format of a tree is written, from the project's export settings. */
function outputFile(
  project: ExportProject,
  treePath: string,
  format: ExportFormat,
  options: ExportOptions,
): { path: string; baseName: string } | undefined {
  const defaults = isBuiltinExportFormat(format)
    ? FORMAT_DEFAULTS[format]
    : project.exporters.get(format);
  if (!defaults) {
    return undefined;
  }
  const config = formatConfig(project.file, format);
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
  const plugin: PluginLoad = {
    load: needsPlugin(formats),
    trustAllPlugins: options.trustAllPlugins,
  };
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
      project = await loadExportProject(tree.path, plugin, cache);
    } catch {
      continue; // Reported by the tree's own export.
    }
    if (!project) {
      continue;
    }
    for (const format of formats) {
      const output = outputFile(project, tree.path, format, options);
      if (!output) {
        continue; // Unknown format: reported by the tree's own export.
      }
      const { path } = output;
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

/** Throws HttpError 400 for a format that is neither built in nor defined by owl-bt.js. */
function checkFormats(project: ExportProject, formats: ExportFormat[]): void {
  for (const format of formats) {
    if (!isBuiltinExportFormat(format) && !project.exporters.has(format)) {
      const reason = project.pluginError ?? project.pluginWarnings.join('; ');
      throw new HttpError(
        400,
        `Unknown export format: ${format}${reason === '' ? '' : ` (${reason})`}`,
      );
    }
  }
}

/** Runs a plugin exporter and checks that it produced text. */
async function renderPluginExport(
  exporter: ResolvedPluginExporter,
  model: ExportModel,
  ctx: Parameters<ResolvedPluginExporter['render']>[1],
): Promise<string | Uint8Array> {
  const content: unknown = await exporter.render(model, ctx);
  if (typeof content === 'string' || content instanceof Uint8Array) {
    return content;
  }
  throw new Error(
    `render must return a string or a Buffer, got ${content === null ? 'null' : typeof content}`,
  );
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isExportFormat(value: unknown): value is ExportFormat {
  return isBuiltinExportFormat(value) || isPluginFormatName(value);
}

/**
 * Validates the `formats` of a request: a non-empty list of built-in formats or plugin format
 * names, without duplicates. Whether the plugin defines a format is checked when exporting.
 */
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
  subtreeCache?: SubtreeFileCache,
): Promise<ExportTreeResult> {
  const project = await loadExportProject(
    treePath,
    { load: needsPlugin(formats), trustAllPlugins: options.trustAllPlugins },
    cache,
  );
  if (!project) {
    throw new HttpError(404, 'No project found');
  }
  checkFormats(project, formats);

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

  const subtrees = subtreeExportMode(project.file);
  let model: ReturnType<typeof buildExportModel>;
  try {
    // Referenced trees are loaded to inline them, or to warn about missing files and cycles.
    const refs = collectSubtreeRefsJson(json, project.compiled);
    let library: SubtreeLibrary | undefined;
    if (refs.length > 0) {
      library = await loadSubtreeLibrary(project.dir, project.compiled, refs, {
        cache: subtreeCache,
      });
    }
    model = buildExportModel(nodeFromJson(json, createIdGen()), project.compiled, {
      subtrees: subtrees.mode,
      library,
      treeRef: treeRefOf(project.dir, treePath),
    });
  } catch (err) {
    return { ...result, error: messageOf(err) };
  }
  result.warnings = subtrees.warning ? [subtrees.warning, ...model.warnings] : model.warnings;

  const projectFile = project.file;
  const sourcePath = relative(project.dir, treePath).split(sep).join('/');

  for (const format of formats) {
    const config = formatConfig(projectFile, format);
    const output = outputFile(project, treePath, format, options);
    if (!output) {
      continue; // Checked above.
    }
    const { path, baseName } = output;
    let content: string | Uint8Array;
    const exporter = project.exporters.get(format);
    if (!isBuiltinExportFormat(format) && exporter) {
      try {
        content = await renderPluginExport(exporter, model, {
          format,
          tree: json,
          treePath,
          sourcePath,
          baseName,
          outPath: path,
          project: projectFile,
          projectDir: project.dir,
          config: { ...config },
          warn: (message) => result.warnings.push(`${format}: ${String(message)}`),
        });
      } catch (err) {
        return { ...result, error: `Exporter ${format} failed: ${messageOf(err)}` };
      }
    } else if (format === 'erlang') {
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
  const subtreeCache: SubtreeFileCache = new Map();
  const { trees } = workspace;
  if (needsPlugin(formats)) {
    // Fail the whole batch for a format the project's plugin does not define.
    const project = await loadExportProject(
      join(workspace.projectDir, PROJECT_FILE_NAME),
      { load: true, trustAllPlugins: options.trustAllPlugins },
      cache,
    );
    if (project) {
      checkFormats(project, formats);
    }
  }
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
            ...(await exportTreeIn(tree.path, formats, options, cache, subtreeCache)),
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
