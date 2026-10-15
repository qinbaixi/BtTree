import {
  checkSubtrees,
  collectSubtreeRefs,
  findNode,
  subtreeRefOf,
  type CompiledProject,
  type SubtreeLibrary,
  type SubtreeProblem,
  type TreeNode,
} from '@owlbt/shared';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { resolveSubtrees, type SubtreeResolution } from '../lib/api';
import { projectStore } from './projectStore';
import { treeStore } from './treeStore';

/** Delay before references added while editing are loaded. */
export const SUBTREE_SYNC_DELAY = 300;

export interface SubtreeStoreDeps {
  resolve(treePath: string, refs?: readonly string[]): Promise<SubtreeResolution>;
  getTree(): { root?: TreeNode; treePath?: string };
  getProject(): CompiledProject | undefined;
}

export interface SubtreeState {
  /** Tree the library belongs to. */
  treePath?: string;
  /** Folder of owl-bt.json (references are relative to it). */
  projectDir?: string;
  /** Project-relative path of the open tree. */
  self?: string;
  /** Referenced trees loaded so far (including nested references). */
  library: SubtreeLibrary;
  /** Problems of the open tree's subtree nodes by node id; references still loading are left out. */
  problems: ReadonlyMap<string, SubtreeProblem>;
  loading: boolean;
  /** Last request error (e.g. the server is unreachable). */
  error?: string;
  /** Loads the references of the open tree that are not loaded yet. */
  sync(): Promise<void>;
  /** Reloads every reference of the open tree. Resolves true when the library changed. */
  refresh(): Promise<boolean>;
  /** Recomputes the problems from the current tree, project and library. */
  recompute(): void;
  /** Forgets everything and starts over for a tree. */
  reset(treePath?: string): void;
}

const defaultDeps: SubtreeStoreDeps = {
  resolve: resolveSubtrees,
  getTree: () => treeStore.getState(),
  getProject: () => projectStore.getState().project,
};

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createSubtreeStore(overrides: Partial<SubtreeStoreDeps> = {}) {
  const deps: SubtreeStoreDeps = { ...defaultDeps, ...overrides };

  return createStore<SubtreeState>()((set, get) => {
    let token = 0;

    const computeProblems = (
      library: SubtreeLibrary,
      self: string | undefined,
    ): Map<string, SubtreeProblem> => {
      const { root } = deps.getTree();
      const project = deps.getProject();
      if (!root || !project) {
        return new Map();
      }
      const problems = checkSubtrees(root, project, library, self);
      for (const [id, problem] of problems) {
        if (problem.kind !== 'missing') continue;
        const node = findNode(root, id);
        const ref = node ? subtreeRefOf(node, project) : undefined;
        if (ref && 'ref' in ref && !Object.hasOwn(library, ref.ref)) {
          problems.delete(id); // Not loaded yet.
        }
      }
      return problems;
    };

    /** Loads `refs` (all references of the tree when `full`) and merges or replaces the library. */
    const load = async (refs: string[], full: boolean): Promise<boolean> => {
      const { treePath } = deps.getTree();
      if (!treePath) {
        return false;
      }
      const current = ++token;
      set({ loading: true });
      try {
        const result = await deps.resolve(treePath, refs);
        if (current !== token || deps.getTree().treePath !== treePath) {
          return false;
        }
        const before = get().library;
        const library = full ? result.library : { ...before, ...result.library };
        const changed = JSON.stringify(before) !== JSON.stringify(library);
        const self = result.self ?? undefined;
        set({
          treePath,
          projectDir: result.projectDir,
          self,
          library,
          loading: false,
          error: undefined,
          problems: computeProblems(library, self),
        });
        return changed;
      } catch (err) {
        if (current === token) {
          set({ loading: false, error: errorText(err) });
        }
        return false;
      }
    };

    const refsOfTree = (): string[] => {
      const { root } = deps.getTree();
      const project = deps.getProject();
      return root && project ? collectSubtreeRefs(root, project) : [];
    };

    return {
      library: {},
      problems: new Map(),
      loading: false,

      async sync() {
        const { library } = get();
        const missing = refsOfTree().filter((ref) => !Object.hasOwn(library, ref));
        if (missing.length > 0) {
          await load(missing, false);
        }
      },

      async refresh() {
        const refs = refsOfTree();
        if (refs.length === 0) {
          const changed = Object.keys(get().library).length > 0;
          set({ library: {}, problems: new Map() });
          return changed;
        }
        return load(refs, true);
      },

      recompute() {
        const { library, self } = get();
        set({ problems: computeProblems(library, self) });
      },

      reset(treePath) {
        token++;
        set({
          treePath,
          projectDir: undefined,
          self: undefined,
          library: {},
          problems: new Map(),
          loading: false,
          error: undefined,
        });
      },
    };
  });
}

export type SubtreeStore = ReturnType<typeof createSubtreeStore>;

/** Application-wide subtree store (references of the open tree). */
export const subtreeStore: SubtreeStore = createSubtreeStore();

export function useSubtreeStore<T>(selector: (state: SubtreeState) => T): T {
  return useStore(subtreeStore, selector);
}

/** Problem of a subtree node of the open tree (undefined when it is fine or not a reference). */
export function useSubtreeProblem(nodeId: string | undefined): SubtreeProblem | undefined {
  return useSubtreeStore((state) => (nodeId ? state.problems.get(nodeId) : undefined));
}

/**
 * Keeps the subtree store in step with the open tree: problems are recomputed on every tree or
 * project change, new references are loaded shortly after they are typed, and a project change
 * reloads everything. Returns the function that stops it.
 */
export function startSubtreeSync(
  treePath: string,
  store: SubtreeStore = subtreeStore,
  trees: typeof treeStore = treeStore,
  projects: typeof projectStore = projectStore,
): () => void {
  store.getState().reset(treePath);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void store.getState().sync();
    }, SUBTREE_SYNC_DELAY);
  };

  const unsubscribeTree = trees.subscribe((state, previous) => {
    if (state.root !== previous.root) {
      store.getState().recompute();
      schedule();
    }
  });
  const unsubscribeProject = projects.subscribe((state, previous) => {
    if (state.project !== previous.project) {
      store.getState().recompute();
      void store.getState().refresh();
    }
  });
  schedule();

  return () => {
    if (timer !== undefined) clearTimeout(timer);
    unsubscribeTree();
    unsubscribeProject();
    store.getState().reset(undefined);
  };
}
