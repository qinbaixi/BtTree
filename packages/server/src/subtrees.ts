import { readFile, stat } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import {
  collectSubtreeRefsJson,
  normalizeSubtreeRef,
  type CompiledProject,
  type SubtreeEntry,
  type SubtreeLibrary,
  type TreeNodeJson,
} from '@owlbt/shared';
import { isErrno } from './errors';
import { isPathInDir } from './project';
import { MAX_TREE_FILE_BYTES } from './workspace';

/** Most tree files one resolution loads (the open tree's references and theirs, recursively). */
export const MAX_SUBTREE_FILES = 200;

const UTF8_BOM = String.fromCharCode(0xfeff);

/** Loaded entries by absolute path, shared by the trees of one export batch. */
export type SubtreeFileCache = Map<string, Promise<SubtreeEntry>>;

export interface LoadSubtreesOptions {
  /** Changes a tree after it was read (the project plugin's onTreeLoad). */
  transform?: (path: string, tree: TreeNodeJson) => Promise<TreeNodeJson>;
  cache?: SubtreeFileCache;
}

/** Project-relative path of a tree file with forward slashes; undefined outside the project. */
export function treeRefOf(projectDir: string, treePath: string): string | undefined {
  if (!isPathInDir(treePath, projectDir)) {
    return undefined;
  }
  const result = normalizeSubtreeRef(relative(projectDir, resolve(treePath)).split(sep).join('/'));
  return 'ref' in result ? result.ref : undefined;
}

function isTreeObject(value: unknown): value is TreeNodeJson {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

async function readEntry(
  ref: string,
  path: string,
  options: LoadSubtreesOptions,
): Promise<SubtreeEntry> {
  let raw: string;
  try {
    const info = await stat(path);
    if (!info.isFile()) {
      return { error: 'missing', message: `Referenced tree '${ref}' not found` };
    }
    if (info.size > MAX_TREE_FILE_BYTES) {
      return { error: 'invalid', message: `Referenced tree '${ref}' is too large` };
    }
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if (isErrno(err, 'ENOENT') || isErrno(err, 'ENOTDIR')) {
      return { error: 'missing', message: `Referenced tree '${ref}' not found` };
    }
    return {
      error: 'invalid',
      message: `Cannot read '${ref}': ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  let tree: unknown;
  try {
    tree = JSON.parse(raw.startsWith(UTF8_BOM) ? raw.slice(1) : raw);
  } catch (err) {
    return {
      error: 'invalid',
      message: `Invalid JSON in '${ref}': ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!isTreeObject(tree)) {
    return { error: 'invalid', message: `'${ref}' is not a tree file` };
  }
  return { path, tree: options.transform ? await options.transform(path, tree) : tree };
}

/**
 * Loads the trees named by `refs` (project-relative paths) and, recursively, the trees their own
 * subtree nodes reference. Every reference gets an entry: the loaded tree, or why it cannot be
 * used (outside the project, missing, not a tree). Stops after MAX_SUBTREE_FILES files; cycles are
 * loaded once and left to the caller (see checkSubtrees / expandSubtrees).
 */
export async function loadSubtreeLibrary(
  projectDir: string,
  project: CompiledProject,
  refs: readonly unknown[],
  options: LoadSubtreesOptions = {},
): Promise<SubtreeLibrary> {
  const library: SubtreeLibrary = {};
  const queue: string[] = [];
  const enqueue = (raw: unknown): void => {
    const result = normalizeSubtreeRef(raw);
    if ('ref' in result && !Object.hasOwn(library, result.ref) && !queue.includes(result.ref)) {
      queue.push(result.ref);
    }
  };
  refs.forEach(enqueue);

  let loaded = 0;
  while (queue.length > 0 && loaded < MAX_SUBTREE_FILES) {
    const ref = queue.shift() as string;
    const path = resolve(projectDir, ref);
    if (!isPathInDir(path, projectDir)) {
      library[ref] = {
        error: 'outside',
        message: 'Referenced tree must be inside the project folder',
      };
      continue;
    }
    loaded++;
    let pending = options.cache?.get(path);
    if (!pending) {
      pending = readEntry(ref, path, options);
      options.cache?.set(path, pending);
    }
    const entry = await pending;
    library[ref] = entry;
    if ('tree' in entry) {
      collectSubtreeRefsJson(entry.tree, project).forEach(enqueue);
    }
  }
  return library;
}
