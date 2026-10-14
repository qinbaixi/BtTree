import { getItemType, SUBTREE_PROPERTY, SUBTREE_PROPERTY_DESC } from './compileProject';
import { createIdGen, nodeFromJson } from './treeModel';
import type { CompiledItemType, CompiledProject, TreeNode, TreeNodeJson } from './types';
import { getEffectiveValue } from './validation';

/*
 * Subtree references: a node whose type is marked `"subtree": true` runs another tree file of the
 * project. The referenced file is the value of its `Tree` property, a path relative to the project
 * folder (the folder of owl-bt.json) with forward slashes.
 */

/** Deepest chain of nested subtrees that is expanded (run mode, inline export). */
export const MAX_SUBTREE_DEPTH = 16;

/** Most nodes an expansion may produce (protects against exponential reuse). */
export const MAX_EXPANDED_NODES = 20000;

/** Why a reference cannot be used. */
export type SubtreeProblemKind = 'empty' | 'outside' | 'missing' | 'invalid' | 'cycle' | 'depth';

export interface SubtreeProblem {
  kind: SubtreeProblemKind;
  message: string;
}

/** Load error of a referenced tree file (from the server). */
export interface SubtreeLoadError {
  error: 'missing' | 'outside' | 'invalid';
  message: string;
}

/** A loaded tree file: `path` is the absolute path on the server. */
export interface SubtreeLoaded {
  path?: string;
  tree: TreeNodeJson;
}

export type SubtreeEntry = SubtreeLoaded | SubtreeLoadError;

/** Loaded tree files by normalized reference (see normalizeSubtreeRef). */
export type SubtreeLibrary = Record<string, SubtreeEntry>;

export function isSubtreeLoaded(entry: SubtreeEntry | undefined): entry is SubtreeLoaded {
  return entry !== undefined && 'tree' in entry;
}

/** True for node types marked as subtree references. */
export function isSubtreeType(type: CompiledItemType): boolean {
  return type.subtree === true;
}

export type NormalizedRef = { ref: string } | { error: 'empty' | 'outside' };

/**
 * Normalizes a reference: forward slashes, no `.` / `..` segments, `.json` appended when missing.
 * Absolute paths and paths that leave the project folder are rejected as 'outside'.
 */
export function normalizeSubtreeRef(raw: unknown): NormalizedRef {
  if (typeof raw !== 'string') {
    return { error: 'empty' };
  }
  const text = raw.trim().replace(/\\/g, '/');
  if (text === '') {
    return { error: 'empty' };
  }
  if (text.startsWith('/') || /^[A-Za-z]:/.test(text)) {
    return { error: 'outside' };
  }
  const out: string[] = [];
  for (const segment of text.split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (out.length === 0) {
        return { error: 'outside' };
      }
      out.pop();
      continue;
    }
    out.push(segment);
  }
  if (out.length === 0) {
    return { error: 'empty' };
  }
  const ref = out.join('/');
  return { ref: /\.json$/i.test(ref) ? ref : `${ref}.json` };
}

/** Display name of a referenced tree: the file name without `.json`. */
export function subtreeName(ref: string): string {
  const last = ref.slice(ref.lastIndexOf('/') + 1);
  return last.replace(/\.json$/i, '');
}

/** The raw reference of a node (explicit value or default of the Tree property). */
export function rawSubtreeRef(node: TreeNode, type: CompiledItemType): unknown {
  const prop = type.properties.find((p) => p.name === SUBTREE_PROPERTY) ?? SUBTREE_PROPERTY_DESC;
  return getEffectiveValue(prop, node.properties);
}

/** Normalized reference of a subtree node; undefined when the node is not a subtree reference. */
export function subtreeRefOf(node: TreeNode, project: CompiledProject): NormalizedRef | undefined {
  const type = getItemType(project, 'node', node.type);
  if (!isSubtreeType(type)) {
    return undefined;
  }
  return normalizeSubtreeRef(rawSubtreeRef(node, type));
}

/** Unique valid references of the subtree nodes of a tree, in tree order. */
export function collectSubtreeRefs(root: TreeNode, project: CompiledProject): string[] {
  const refs: string[] = [];
  const visit = (node: TreeNode): void => {
    const result = subtreeRefOf(node, project);
    if (result && 'ref' in result && !refs.includes(result.ref)) {
      refs.push(result.ref);
    }
    for (const child of node.childNodes) {
      visit(child);
    }
  };
  visit(root);
  return refs;
}

/** Same as collectSubtreeRefs for a tree file's JSON. */
export function collectSubtreeRefsJson(json: TreeNodeJson, project: CompiledProject): string[] {
  return collectSubtreeRefs(nodeFromJson(json, createIdGen()), project);
}

function loadProblem(ref: string, entry: SubtreeEntry | undefined): SubtreeProblem | undefined {
  if (entry === undefined) {
    return { kind: 'missing', message: `Referenced tree '${ref}' is not loaded` };
  }
  if (isSubtreeLoaded(entry)) {
    return undefined;
  }
  return { kind: entry.error, message: entry.message };
}

function refProblem(result: NormalizedRef): SubtreeProblem | undefined {
  if ('ref' in result) {
    return undefined;
  }
  return result.error === 'empty'
    ? { kind: 'empty', message: 'No tree referenced' }
    : { kind: 'outside', message: 'Referenced tree must be inside the project folder' };
}

/**
 * Checks every subtree node of a tree: empty references, references outside the project, files
 * that are missing or invalid in the library, and references that lead into a cycle
 * (A → B → A, including back to `selfRef`, the project-relative path of the tree itself).
 * Returns the problems by node id; nodes without problems are not listed.
 */
export function checkSubtrees(
  root: TreeNode,
  project: CompiledProject,
  library: SubtreeLibrary,
  selfRef?: string,
): Map<string, SubtreeProblem> {
  const problems = new Map<string, SubtreeProblem>();
  const ownRefs = collectSubtreeRefs(root, project);
  const edgeCache = new Map<string, string[]>();
  const edges = (ref: string): string[] => {
    if (ref === selfRef) {
      return ownRefs;
    }
    let list = edgeCache.get(ref);
    if (!list) {
      const entry = library[ref];
      list = isSubtreeLoaded(entry) ? collectSubtreeRefsJson(entry.tree, project) : [];
      edgeCache.set(ref, list);
    }
    return list;
  };

  // Cycle reachable from a reference, as the chain of references that closes it.
  const memo = new Map<string, string[] | null>();
  const visiting: string[] = selfRef !== undefined ? [selfRef] : [];
  const findCycle = (ref: string): string[] | null => {
    const known = memo.get(ref);
    if (known !== undefined) {
      return known;
    }
    const index = visiting.indexOf(ref);
    if (index >= 0) {
      return [...visiting.slice(index), ref];
    }
    visiting.push(ref);
    let found: string[] | null = null;
    for (const next of edges(ref)) {
      found = findCycle(next);
      if (found) {
        break;
      }
    }
    visiting.pop();
    memo.set(ref, found);
    return found;
  };

  const visit = (node: TreeNode): void => {
    const result = subtreeRefOf(node, project);
    if (result) {
      const problem =
        refProblem(result) ??
        ('ref' in result ? loadProblem(result.ref, library[result.ref]) : undefined);
      if (problem && !('ref' in result && result.ref === selfRef)) {
        problems.set(node.id, problem);
      } else if ('ref' in result) {
        const cycle = findCycle(result.ref);
        if (cycle) {
          problems.set(node.id, {
            kind: 'cycle',
            message: `Subtree cycle: ${cycle.join(' → ')}`,
          });
        }
      }
    }
    for (const child of node.childNodes) {
      visit(child);
    }
  };
  visit(root);
  return problems;
}

export interface ExpandOptions {
  /**
   * 'child' (run mode): the referenced tree becomes the only child of the reference node.
   * 'inline' (export): the referenced tree's root replaces the reference node; the reference
   * node's decorators and services are put before the root's own.
   */
  mode: 'child' | 'inline';
  /** Project-relative path of the expanded tree itself (closes cycles back to it). */
  selfRef?: string;
}

export interface ExpandResult {
  root: TreeNode;
  /** Problems of reference nodes that could not be expanded, by node id. */
  errors: Map<string, SubtreeProblem>;
  /** The reference of each expanded reference node, by node id. */
  refs: Map<string, string>;
}

/**
 * Expands the subtree references of a tree with the trees of the library, recursively. The input
 * tree is not modified. Nodes of a referenced tree get ids `<reference node id>/<n>`, so they are
 * stable for one tree and library. Cycles, too deep nesting and unusable references are not
 * expanded; they are reported in `errors` (keyed by the id of the reference node).
 */
export function expandSubtrees(
  root: TreeNode,
  project: CompiledProject,
  library: SubtreeLibrary,
  options: ExpandOptions,
): ExpandResult {
  const errors = new Map<string, SubtreeProblem>();
  const refs = new Map<string, string>();
  const stack: string[] = options.selfRef !== undefined ? [options.selfRef] : [];
  let count = 0;

  const expandNode = (node: TreeNode, depth: number): TreeNode => {
    count++;
    const result = subtreeRefOf(node, project);
    if (!result) {
      const children = node.childNodes.map((child) => expandNode(child, depth));
      // Unchanged parts of the tree are kept as they are.
      return children.every((child, i) => child === node.childNodes[i])
        ? node
        : { ...node, childNodes: children };
    }

    const fail = (problem: SubtreeProblem): TreeNode => {
      errors.set(node.id, problem);
      return node.childNodes.length === 0 ? node : { ...node, childNodes: [] };
    };

    const invalid = refProblem(result);
    if (invalid || !('ref' in result)) {
      return fail(invalid ?? { kind: 'empty', message: 'No tree referenced' });
    }
    const ref = result.ref;
    if (stack.includes(ref)) {
      const chain = [...stack.slice(stack.indexOf(ref)), ref];
      return fail({ kind: 'cycle', message: `Subtree cycle: ${chain.join(' → ')}` });
    }
    const entry = library[ref];
    const missing = loadProblem(ref, entry);
    if (missing || !isSubtreeLoaded(entry)) {
      return fail(missing ?? { kind: 'missing', message: `Referenced tree '${ref}' not found` });
    }
    if (depth >= MAX_SUBTREE_DEPTH) {
      return fail({
        kind: 'depth',
        message: `Subtrees nested deeper than ${MAX_SUBTREE_DEPTH} levels`,
      });
    }
    if (count > MAX_EXPANDED_NODES) {
      return fail({
        kind: 'depth',
        message: `Expanded tree has more than ${MAX_EXPANDED_NODES} nodes`,
      });
    }

    refs.set(node.id, ref);
    stack.push(ref);
    const inner = expandNode(nodeFromJson(entry.tree, createIdGen(`${node.id}/`)), depth + 1);
    stack.pop();

    if (options.mode === 'child') {
      return { ...node, childNodes: [inner] };
    }
    const merged: TreeNode = {
      ...inner,
      decorators: [...node.decorators, ...inner.decorators],
      services: [...node.services, ...inner.services],
    };
    // The inlined root keeps the label of the reference node when it has none of its own.
    if (merged.label === undefined && node.label !== undefined) {
      merged.label = node.label;
    }
    return merged;
  };

  return { root: expandNode(root, 0), errors, refs };
}

/** The node of the open tree that a node id of an expanded tree belongs to. */
export function subtreeOwnerId(nodeId: string): string {
  const index = nodeId.indexOf('/');
  return index < 0 ? nodeId : nodeId.slice(0, index);
}
