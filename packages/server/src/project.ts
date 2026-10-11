import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Module, createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
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
}

export interface PluginStatus {
  /** Absolute path of owl-bt.js. */
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
  /** Set when owl-bt.js exists. Untrusted plugins are not loaded. */
  pluginStatus?: PluginStatus;
}

export interface ProjectOptions {
  /** Runs owl-bt.js without checking the trust store (the --trust-plugins flag). */
  trustAllPlugins?: boolean;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Walks up from the directory of `treePath` and returns the nearest owl-bt.json. */
export async function findProjectFile(treePath: string): Promise<string | undefined> {
  let dir = dirname(resolve(treePath));
  for (;;) {
    const candidate = join(dir, PROJECT_FILE_NAME);
    if (isFile(candidate)) {
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

/**
 * Loads the project that applies to a tree or project file. The plugin next to owl-bt.json runs
 * only when the trust store has the current content of owl-bt.js (or trustAllPlugins is set).
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
  if (!existsSync(pluginPath)) {
    return { path, dir, content };
  }

  const source = await readFile(pluginPath, 'utf8');
  if (options.trustAllPlugins === true) {
    return {
      path,
      dir,
      content,
      plugin: compilePlugin(pluginPath, source),
      pluginStatus: { path: pluginPath, trusted: true },
    };
  }
  const status = await trustStatus(pluginPath, source);
  if (!status.trusted) {
    return {
      path,
      dir,
      content,
      pluginStatus: { path: pluginPath, trusted: false, changed: status.changed },
    };
  }
  return {
    path,
    dir,
    content,
    plugin: compilePlugin(pluginPath, source),
    pluginStatus: { path: pluginPath, trusted: true },
  };
}

/** True when `file` is `dir` or lies inside it. Case-insensitive on Windows. */
export function isPathInDir(file: string, dir: string): boolean {
  const norm = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p);
  const rel = relative(norm(resolve(dir)), norm(resolve(file)));
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
}
