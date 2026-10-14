import type { Dirent, Stats } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError, isErrno } from './errors';
import { findProjectFile, PROJECT_FILE_NAME } from './project';

/** Templates shipped with the package. Resolves from both src/ and the bundled dist/. */
export const TEMPLATES_DIR = fileURLToPath(new URL('../templates/', import.meta.url));

/**
 * Folder with the templates. OWLBT_TEMPLATES_DIR overrides the default, for bundles where the
 * module location does not contain the templates (the desktop app). Read on every call.
 */
export function templatesDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.OWLBT_TEMPLATES_DIR ? resolve(env.OWLBT_TEMPLATES_DIR) : TEMPLATES_DIR;
}

export const MAX_TREE_RESULTS = 500;
/** Directory levels below the scan root that are searched. */
export const MAX_SCAN_DEPTH = 6;
export const MAX_TREE_FILE_BYTES = 5 * 1024 * 1024;
/** Candidate files of one folder that are read at the same time. */
export const SCAN_CONCURRENCY = 4;

const SKIPPED_DIRS = new Set(['node_modules']);
const SKIPPED_FILES = new Set(['owl-bt.json', 'package.json', 'package-lock.json']);
const SKIPPED_TSCONFIG = /^tsconfig.*\.json$/i;

export interface WorkspaceTree {
  /** Absolute path of the tree file. */
  path: string;
  /** Path relative to the scan root, with forward slashes. */
  relPath: string;
}

export interface Workspace {
  /** Absolute folder the listing was made for. */
  dir: string;
  /** owl-bt.json found by walking up from dir. */
  projectPath?: string;
  projectDir?: string;
  trees: WorkspaceTree[];
  truncated: boolean;
}

export function readTemplate(name: string): Promise<string> {
  return readFile(join(templatesDir(), name), 'utf8');
}

/** Creates the file with `content`. Returns false (and leaves the file alone) when it already exists. */
export async function writeNewFile(path: string, content: string): Promise<boolean> {
  try {
    await writeFile(path, content, { encoding: 'utf8', flag: 'wx' });
    return true;
  } catch (err) {
    if (isErrno(err, 'EEXIST')) {
      return false;
    }
    throw err;
  }
}

async function statOrUndefined(path: string): Promise<Stats | undefined> {
  try {
    return await stat(path);
  } catch {
    return undefined;
  }
}

/** A tree is a JSON object with a string `type` field. */
function isTreeObject(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

function isSkippedDir(name: string): boolean {
  return name.startsWith('.') || SKIPPED_DIRS.has(name);
}

function isCandidateFile(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.json') && !SKIPPED_FILES.has(lower) && !SKIPPED_TSCONFIG.test(name);
}

async function isTreeFile(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    if (info.size > MAX_TREE_FILE_BYTES) {
      return false;
    }
    const text = await readFile(path, 'utf8');
    // Tree files may start with a UTF-8 BOM (the tree editor keeps it).
    return isTreeObject(JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text));
  } catch {
    return false; // Unreadable or not JSON.
  }
}

interface ScanState {
  root: string;
  trees: WorkspaceTree[];
  truncated: boolean;
}

async function scanDir(dirPath: string, depth: number, state: ScanState): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return; // Unreadable folders are skipped.
  }

  let i = 0;
  while (i < entries.length) {
    if (state.truncated) {
      return;
    }
    const entry = entries[i];
    if (entry.isDirectory()) {
      i++;
      if (depth < MAX_SCAN_DEPTH && !isSkippedDir(entry.name)) {
        await scanDir(join(dirPath, entry.name), depth + 1, state);
      }
      continue;
    }
    // Up to SCAN_CONCURRENCY candidate files up to the next directory are read at the same time;
    // they are added in listing order, so the result (and where truncation happens) is unchanged.
    const batch: string[] = [];
    while (i < entries.length && !entries[i].isDirectory() && batch.length < SCAN_CONCURRENCY) {
      const file = entries[i++];
      if (file.isFile() && isCandidateFile(file.name)) {
        batch.push(join(dirPath, file.name));
      }
    }
    const isTree = await Promise.all(batch.map((full) => isTreeFile(full)));
    for (let j = 0; j < batch.length; j++) {
      if (!isTree[j]) {
        continue;
      }
      if (state.trees.length >= MAX_TREE_RESULTS) {
        state.truncated = true;
        return;
      }
      const full = batch[j];
      state.trees.push({ path: full, relPath: relative(state.root, full).split(sep).join('/') });
    }
  }
}

/**
 * Lists the tree files for a folder, or for the folder that contains the given file.
 * The scan covers the project directory when one exists, otherwise the folder itself.
 */
export async function loadWorkspace(rawPath: string): Promise<Workspace> {
  const target = resolve(rawPath);
  const info = await statOrUndefined(target);
  let dir: string;
  if (info?.isDirectory()) {
    dir = target;
  } else if (info?.isFile()) {
    dir = dirname(target);
  } else {
    throw new HttpError(404, 'Path not found');
  }

  // A child path makes findProjectFile start its walk at dir itself.
  const projectPath = await findProjectFile(join(dir, 'probe'));
  const projectDir = projectPath ? dirname(projectPath) : undefined;
  const root = projectDir ?? dir;

  const state: ScanState = { root, trees: [], truncated: false };
  await scanDir(root, 0, state);
  state.trees.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));

  const workspace: Workspace = { dir, trees: state.trees, truncated: state.truncated };
  if (projectPath && projectDir) {
    workspace.projectPath = projectPath;
    workspace.projectDir = projectDir;
  }
  return workspace;
}

/** Writes owl-bt.json and trees/example.json into an existing folder that is not inside a project. */
export async function initProject(rawDir: string): Promise<Workspace> {
  const dir = resolve(rawDir);
  const info = await statOrUndefined(dir);
  if (!info?.isDirectory()) {
    throw new HttpError(404, 'Directory not found');
  }
  if (await findProjectFile(join(dir, 'probe'))) {
    throw new HttpError(409, 'Directory is already inside a project');
  }

  const created = await writeNewFile(
    join(dir, PROJECT_FILE_NAME),
    await readTemplate('owl-bt.json'),
  );
  if (!created) {
    throw new HttpError(409, `${PROJECT_FILE_NAME} already exists`);
  }

  const examplePath = join(dir, 'trees', 'example.json');
  if (!(await statOrUndefined(examplePath))) {
    await mkdir(dirname(examplePath), { recursive: true });
    await writeNewFile(examplePath, await readTemplate('example-tree.json'));
  }

  return loadWorkspace(dir);
}

/** Appends .json unless the path already ends with it (case-insensitive). */
export function withJsonExtension(path: string): string {
  return /\.json$/i.test(path) ? path : `${path}.json`;
}
