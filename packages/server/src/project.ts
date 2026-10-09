import { existsSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Module, createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { ProjectFile, TreeNodeJson } from '@owlbt/shared';

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

export interface Project {
  /** Absolute path of owl-bt.json. */
  path: string;
  /** Directory containing owl-bt.json. */
  dir: string;
  content: string;
  plugin?: Plugin;
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
 * Loads the CommonJS plugin fresh on every call (the module cache entry is dropped first),
 * so edits to owl-bt.js are picked up without restarting the server.
 */
export function loadPlugin(pluginPath: string): Plugin | undefined {
  if (!existsSync(pluginPath)) {
    return undefined;
  }
  // Compile as CommonJS regardless of the nearest package.json "type", without touching the module cache.
  const mod = new Module(pluginPath) as Module & { _compile(code: string, filename: string): void };
  mod.filename = pluginPath;
  mod.paths = (Module as unknown as { _nodeModulePaths(dir: string): string[] })._nodeModulePaths(
    dirname(pluginPath),
  );
  mod.require = createRequire(pluginPath);
  mod._compile(readFileSync(pluginPath, 'utf8'), pluginPath);
  const exported: unknown = mod.exports;
  return typeof exported === 'object' && exported !== null ? (exported as Plugin) : undefined;
}

export async function getProject(treePath: string): Promise<Project | undefined> {
  const path = await findProjectFile(treePath);
  if (!path) {
    return undefined;
  }
  const dir = dirname(path);
  const content = await readFile(path, 'utf8');
  const plugin = loadPlugin(join(dir, PLUGIN_FILE_NAME));
  return plugin ? { path, dir, content, plugin } : { path, dir, content };
}

/** True when `file` is `dir` or lies inside it. Case-insensitive on Windows. */
export function isPathInDir(file: string, dir: string): boolean {
  const norm = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p);
  const rel = relative(norm(resolve(dir)), norm(resolve(file)));
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
}
