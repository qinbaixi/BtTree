import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  findTreeUsages,
  isRefKind,
  parseAndCompileProject,
  rewriteTreeReferences,
  type CompiledProject,
  type RefRename,
  type TreeUsage,
  type UsageQuery,
} from '@owlbt/shared';
import { HttpError } from './errors';
import { withFileLock, writeFileAtomic } from './fileLock';
import { formatTreeText, parseTreeText } from './treeFile';
import { loadWorkspace, type WorkspaceTree } from './workspace';

/** Tree files read at the same time. */
export const REFERENCE_CONCURRENCY = 4;
/** Most renames accepted in one request. */
export const MAX_RENAMES = 1000;

export interface TreeReadError {
  path: string;
  relPath: string;
  error: string;
}

export interface FileUsages {
  path: string;
  relPath: string;
  usages: TreeUsage[];
}

export interface ProjectUsagesResult {
  projectDir: string;
  /** True when the workspace listing stopped at its tree limit. */
  truncated: boolean;
  /** Files that use the type or key, in workspace order. */
  files: FileUsages[];
  /** Tree files that could not be read. */
  errors: TreeReadError[];
}

export interface ChangedTree {
  path: string;
  relPath: string;
  /** Number of changed fields. */
  count: number;
  /** Not written because the caller asked to skip the file (e.g. it has unsaved edits). */
  skipped?: boolean;
}

export interface UpdateReferencesResult {
  projectDir: string;
  truncated: boolean;
  dryRun: boolean;
  /** Files that reference a renamed name (written unless dryRun or skipped). */
  changed: ChangedTree[];
  errors: TreeReadError[];
}

export interface UpdateReferencesOptions {
  /** Only count the changes. */
  dryRun?: boolean;
  /** Absolute paths of tree files that must not be written. */
  skip?: readonly string[];
}

interface LoadedProject {
  projectDir: string;
  truncated: boolean;
  trees: WorkspaceTree[];
  compiled?: CompiledProject;
  compileError?: string;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function pathKey(path: string): string {
  const absolute = resolve(path);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

async function loadProjectTrees(path: string): Promise<LoadedProject> {
  const workspace = await loadWorkspace(path);
  if (!workspace.projectPath || !workspace.projectDir) {
    throw new HttpError(404, 'No project found');
  }
  const loaded: LoadedProject = {
    projectDir: workspace.projectDir,
    truncated: workspace.truncated,
    trees: workspace.trees,
  };
  try {
    const result = parseAndCompileProject(await readFile(workspace.projectPath, 'utf8'));
    loaded.compiled = result.project;
    loaded.compileError = result.error;
  } catch (err) {
    loaded.compileError = messageOf(err);
  }
  return loaded;
}

/** Runs `fn` for every item with at most `limit` running at the same time. Results keep the order. */
async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

/** Usages of a type or blackboard key in every tree file of the project that contains `path`. */
export async function findProjectUsages(
  path: string,
  query: UsageQuery,
): Promise<ProjectUsagesResult> {
  const project = await loadProjectTrees(path);
  if (query.kind === 'blackboardKey' && !project.compiled) {
    throw new HttpError(
      400,
      `Project does not compile: ${project.compileError ?? 'unknown error'}`,
    );
  }
  const result: ProjectUsagesResult = {
    projectDir: project.projectDir,
    truncated: project.truncated,
    files: [],
    errors: [],
  };
  const scanned = await mapLimited(project.trees, REFERENCE_CONCURRENCY, async (tree) => {
    try {
      const json = parseTreeText(await readFile(tree.path, 'utf8'));
      return { tree, usages: findTreeUsages(json, query, project.compiled) };
    } catch (err) {
      return { tree, error: messageOf(err) };
    }
  });
  for (const entry of scanned) {
    if (entry.error !== undefined) {
      result.errors.push({
        path: entry.tree.path,
        relPath: entry.tree.relPath,
        error: entry.error,
      });
    } else if (entry.usages && entry.usages.length > 0) {
      result.files.push({
        path: entry.tree.path,
        relPath: entry.tree.relPath,
        usages: entry.usages,
      });
    }
  }
  return result;
}

/**
 * Rewrites the references to renamed types / blackboard keys in every tree file of the project.
 * Each file is read, changed and written atomically under its file lock, keeping indentation, line
 * endings and BOM. Blackboard key renames use the project file on disk (already saved with the new
 * names) to find the blackboardKey properties.
 */
export async function updateProjectReferences(
  path: string,
  renames: readonly RefRename[],
  options: UpdateReferencesOptions = {},
): Promise<UpdateReferencesResult> {
  const project = await loadProjectTrees(path);
  const needsProject = renames.some((rename) => rename.kind === 'blackboardKey');
  if (needsProject && !project.compiled) {
    throw new HttpError(
      400,
      `Project does not compile: ${project.compileError ?? 'unknown error'}`,
    );
  }
  const dryRun = options.dryRun === true;
  const skip = new Set((options.skip ?? []).map(pathKey));
  const result: UpdateReferencesResult = {
    projectDir: project.projectDir,
    truncated: project.truncated,
    dryRun,
    changed: [],
    errors: [],
  };

  const outcomes = await mapLimited(project.trees, REFERENCE_CONCURRENCY, (tree) =>
    withFileLock(tree.path, async () => {
      try {
        const raw = await readFile(tree.path, 'utf8');
        const json = parseTreeText(raw);
        const count = rewriteTreeReferences(json, renames, project.compiled);
        if (count === 0) {
          return { tree, count };
        }
        const skipped = skip.has(pathKey(tree.path));
        if (!dryRun && !skipped) {
          await writeFileAtomic(tree.path, formatTreeText(json, raw));
        }
        return { tree, count, skipped };
      } catch (err) {
        return { tree, count: 0, error: messageOf(err) };
      }
    }),
  );
  for (const outcome of outcomes) {
    const { tree } = outcome;
    if ('error' in outcome && outcome.error !== undefined) {
      result.errors.push({ path: tree.path, relPath: tree.relPath, error: outcome.error });
    } else if (outcome.count > 0) {
      const entry: ChangedTree = { path: tree.path, relPath: tree.relPath, count: outcome.count };
      if ('skipped' in outcome && outcome.skipped) {
        entry.skipped = true;
      }
      result.changed.push(entry);
    }
  }
  return result;
}

/** Validates the `renames` of a request body. */
export function parseRenames(raw: unknown): RefRename[] {
  if (!Array.isArray(raw)) {
    throw new HttpError(400, 'renames must be an array');
  }
  if (raw.length > MAX_RENAMES) {
    throw new HttpError(400, `At most ${MAX_RENAMES} renames are allowed`);
  }
  return raw.map((entry: unknown) => {
    const rename = entry as Partial<RefRename> | null;
    if (
      typeof rename !== 'object' ||
      rename === null ||
      !isRefKind(rename.kind) ||
      typeof rename.from !== 'string' ||
      typeof rename.to !== 'string' ||
      rename.from === '' ||
      rename.to === ''
    ) {
      throw new HttpError(400, 'Each rename needs kind, from and to');
    }
    return { kind: rename.kind, from: rename.from, to: rename.to };
  });
}
