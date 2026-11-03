import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { Module, createRequire } from 'node:module';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { ProjectFile, TreeNodeJson } from '@owlbt/shared';
import { trustStatus } from './pluginTrust';

export const PROJECT_FILE_NAME = 'owl-bt.json';
export const PLUGIN_FILE_NAME = 'owl-bt.js';

export interface PluginContext {
  tree: TreeNodeJson;
  /** Path of the tree file. */
  path: string;
  /** Parsed owl-bt.json. */
  project: ProjectFile;
  projectPath: string;
}

/** Hooks may return anything; `false` forbids the save, a string forbids it with that message. */
export interface Plugin {
  onTreeLoad?(ctx: PluginContext): unknown;
  onTreeSave?(ctx: PluginContext): unknown;
  /** Custom export formats by name (see pluginExporters.ts). */
  exporters?: unknown;
}

export interface PluginStatus {
  /** Absolute path of owl-bt.js, or of the first exporter file when there is no owl-bt.js. */
  path: string;
  trusted: boolean;
  /** True when the plugin was trusted before but its content changed since. */
  changed?: boolean;
}

export interface Project {
  /** Absolute path of owl-bt.json. */
  path: string;
  /** Directory containing owl-bt.json. */
  dir: string;
  content: string;
  /** The plugin, only when it is trusted (or trusting is disabled). */
  plugin?: Plugin;
  /** Set when owl-bt.js or exporters/*.js exists. Untrusted plugins are not loaded. */
  pluginStatus?: PluginStatus;
  /** owl-bt.js (when it exists) and the exporter files: everything trusted together. */
  pluginFiles?: string[];
  /** Exporter files that failed to load or clash with owl-bt.js. */
  pluginWarnings?: string[];
}

export interface ProjectOptions {
  /** Runs owl-bt.js without checking the trust store (the --trust-plugins flag). */
  trustAllPlugins?: boolean;
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** Walks up from the directory of `treePath` and returns the nearest owl-bt.json. */
export async function findProjectFile(treePath: string): Promise<string | undefined> {
  let dir = dirname(resolve(treePath));
  for (;;) {
    const candidate = join(dir, PROJECT_FILE_NAME);
    if (await isFile(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/**
 * Compiles the plugin source as CommonJS (regardless of the nearest package.json "type") and returns
 * its exports. The source is passed in, so the code that runs is the code that was checked.
 */
export function compilePlugin(pluginPath: string, source: string): Plugin | undefined {
  // Built without touching the module cache, so the plugin is evaluated fresh on every call.
  const mod = new Module(pluginPath) as Module & { _compile(code: string, filename: string): void };
  mod.filename = pluginPath;
  mod.paths = (Module as unknown as { _nodeModulePaths(dir: string): string[] })._nodeModulePaths(
    dirname(pluginPath),
  );
  mod.require = createRequire(pluginPath);
  mod._compile(source, pluginPath);
  const exported: unknown = mod.exports;
  return typeof exported === 'object' && exported !== null ? (exported as Plugin) : undefined;
}

/** Folder next to owl-bt.json with one exporter per `<format>.js` file. */
export const EXPORTERS_DIR_NAME = 'exporters';

/** Exporter files of a project folder (`exporters/*.js` and `*.cjs`), sorted by name. */
export async function listExporterFiles(dir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(join(dir, EXPORTERS_DIR_NAME));
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const name of names.sort()) {
    if (/\.c?js$/i.test(name)) {
      const file = join(dir, EXPORTERS_DIR_NAME, name);
      if (await isFile(file)) {
        files.push(file);
      }
    }
  }
  return files;
}

/** Format name of an exporter file: the file name without `.js` / `.cjs`. */
export function exporterFormatOf(file: string): string {
  return basename(file).replace(/\.c?js$/i, '');
}

/** Evaluates one exporter file. A function export is the `render` function. */
function compileExporterFile(file: string, source: string): unknown {
  const mod = new Module(file) as Module & { _compile(code: string, filename: string): void };
  mod.filename = file;
  mod.paths = (Module as unknown as { _nodeModulePaths(dir: string): string[] })._nodeModulePaths(
    dirname(file),
  );
  mod.require = createRequire(file);
  mod._compile(source, file);
  const exported: unknown = mod.exports;
  return typeof exported === 'function' ? { render: exported } : exported;
}

/**
 * Loads the project that applies to a tree or project file. The plugin code (owl-bt.js next to
 * owl-bt.json and the files in exporters/) runs only when the trust store has the current content
 * of every one of those files (or trustAllPlugins is set). Exporter files are merged into
 * `plugin.exporters`; owl-bt.js wins when both define a format.
 */
export async function getProject(
  treePath: string,
  options: ProjectOptions = {},
): Promise<Project | undefined> {
  const path = await findProjectFile(treePath);
  if (!path) {
    return undefined;
  }
  const dir = dirname(path);
  const content = await readFile(path, 'utf8');
  const pluginPath = join(dir, PLUGIN_FILE_NAME);
  const exporterFiles = await listExporterFiles(dir);
  const pluginFiles = [...(existsSync(pluginPath) ? [pluginPath] : []), ...exporterFiles];
  if (pluginFiles.length === 0) {
    return { path, dir, content };
  }

  const sources = await Promise.all(pluginFiles.map((file) => readFile(file, 'utf8')));
  const statusPath = pluginFiles[0];
  if (options.trustAllPlugins !== true) {
    const statuses = await Promise.all(
      pluginFiles.map((file, index) => trustStatus(file, sources[index])),
    );
    if (statuses.some((status) => !status.trusted)) {
      return {
        path,
        dir,
        content,
        pluginFiles,
        pluginStatus: {
          path: statusPath,
          trusted: false,
          changed: statuses.some((status) => status.changed),
        },
      };
    }
  }

  const hasMain = pluginFiles[0] === pluginPath;
  const main = hasMain ? compilePlugin(pluginPath, sources[0]) : undefined;
  const pluginWarnings: string[] = [];
  const fileExporters: Record<string, unknown> = {};
  exporterFiles.forEach((file, index) => {
    const format = exporterFormatOf(file);
    const label = `${EXPORTERS_DIR_NAME}/${basename(file)}`;
    try {
      fileExporters[format] = compileExporterFile(file, sources[index + (hasMain ? 1 : 0)]);
    } catch (err) {
      pluginWarnings.push(
        `${label} failed to load: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });
  const mainExporters: unknown = main?.exporters;
  let exporters: unknown = mainExporters;
  if (Object.keys(fileExporters).length > 0) {
    const fromMain =
      typeof mainExporters === 'object' && mainExporters !== null && !Array.isArray(mainExporters)
        ? (mainExporters as Record<string, unknown>)
        : {};
    for (const format of Object.keys(fileExporters)) {
      if (format in fromMain) {
        pluginWarnings.push(
          `${EXPORTERS_DIR_NAME}/${format}: owl-bt.js also defines exporter "${format}"; using owl-bt.js`,
        );
      }
    }
    exporters = { ...fileExporters, ...fromMain };
  }
  return {
    path,
    dir,
    content,
    plugin: { ...(main ?? {}), exporters },
    pluginFiles,
    pluginWarnings,
    pluginStatus: { path: statusPath, trusted: true },
  };
}

/** True when `file` is `dir` or lies inside it. Case-insensitive on Windows. */
export function isPathInDir(file: string, dir: string): boolean {
  const norm = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p);
  const rel = relative(norm(resolve(dir)), norm(resolve(file)));
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
}
