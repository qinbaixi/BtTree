import {
  collapsedToPaths,
  collapsibleIds,
  hiddenBy,
  pathsToCollapsed,
  type TreeNode,
} from '@owlbt/shared';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { viewportStore, type ViewportState } from '../components/TreeCanvas/viewportStore';
import { getJson, removeStorageItem, setJson } from '../lib/storage';
import type { TreeState } from './treeStore';

/** localStorage key prefix of the collapsed nodes of a tree (followed by the tree path). */
export const COLLAPSE_STORAGE_PREFIX = 'owlbt.collapsed:';

export function collapseStorageKey(treePath: string): string {
  return `${COLLAPSE_STORAGE_PREFIX}${treePath}`;
}

/**
 * Collapsed subtrees of the open tree (view state only, never written into the tree file).
 * Ids are runtime node ids; persisted as child index paths per tree path (see connectCollapse).
 */
export interface CollapseState {
  collapsed: ReadonlySet<string>;
  toggle(nodeId: string): void;
  collapse(nodeIds: Iterable<string>): void;
  expand(nodeIds: Iterable<string>): void;
  /** Replaces the whole set (load, collapse all, expand all). */
  set(nodeIds: Iterable<string>): void;
}

export function createCollapseStore() {
  return createStore<CollapseState>()((set, get) => ({
    collapsed: new Set<string>(),
    toggle(nodeId) {
      const next = new Set(get().collapsed);
      if (!next.delete(nodeId)) {
        next.add(nodeId);
      }
      set({ collapsed: next });
    },
    collapse(nodeIds) {
      const next = new Set(get().collapsed);
      const size = next.size;
      for (const id of nodeIds) {
        next.add(id);
      }
      if (next.size !== size) {
        set({ collapsed: next });
      }
    },
    expand(nodeIds) {
      const next = new Set(get().collapsed);
      let changed = false;
      for (const id of nodeIds) {
        changed = next.delete(id) || changed;
      }
      if (changed) {
        set({ collapsed: next });
      }
    },
    set(nodeIds) {
      set({ collapsed: new Set(nodeIds) });
    },
  }));
}

export type CollapseStore = ReturnType<typeof createCollapseStore>;

export const collapseStore: CollapseStore = createCollapseStore();

export function useCollapsed(): ReadonlySet<string> {
  return useStore(collapseStore, (state) => state.collapsed);
}

/** Ids that "Collapse all" collapses: every node with children except the root. */
export function collapseAllIds(root: TreeNode): string[] {
  return collapsibleIds(root).filter((id) => id !== root.id);
}

type TreeStoreLike = Pick<StoreApi<TreeState>, 'getState' | 'subscribe'>;

/**
 * Keeps the collapse store in sync with the tree store:
 * - restores the persisted state when a tree is loaded and persists every change (per tree path);
 * - expands collapsed ancestors when the selection (keyboard navigation, search, run mode) or a
 *   focus request moves into a collapsed branch;
 * - when collapsing hides the selected item, selects the collapsed node instead.
 * Returns a function that stops syncing.
 */
export function connectCollapse(
  tree: TreeStoreLike,
  collapse: CollapseStore = collapseStore,
  viewport: Pick<StoreApi<ViewportState>, 'subscribe'> = viewportStore,
): () => void {
  let loadedFor: { treePath?: string; loadCount: number } | undefined;

  const restore = (state: TreeState): void => {
    if (!state.root || !state.treePath) {
      return;
    }
    if (loadedFor?.treePath === state.treePath && loadedFor.loadCount === state.loadCount) {
      return;
    }
    loadedFor = { treePath: state.treePath, loadCount: state.loadCount };
    const paths = getJson<unknown>(collapseStorageKey(state.treePath), []);
    collapse.getState().set(pathsToCollapsed(state.root, Array.isArray(paths) ? paths : []));
  };

  const persist = (): void => {
    const { root, treePath } = tree.getState();
    if (!root || !treePath || loadedFor?.treePath !== treePath) {
      return;
    }
    const paths = collapsedToPaths(root, collapse.getState().collapsed);
    if (paths.length > 0) {
      setJson(collapseStorageKey(treePath), paths);
    } else {
      removeStorageItem(collapseStorageKey(treePath));
    }
  };

  const reveal = (nodeId: string | undefined): void => {
    const root = tree.getState().root;
    if (!root || nodeId === undefined) {
      return;
    }
    const hiding = hiddenBy(root, nodeId, collapse.getState().collapsed);
    if (hiding.length > 0) {
      collapse.getState().expand(hiding);
    }
  };

  restore(tree.getState());
  reveal(tree.getState().selection?.nodeId);

  const unsubscribeTree = tree.subscribe((state, prev) => {
    if (!state.root) {
      if (prev.root) {
        loadedFor = undefined;
        collapse.getState().set([]);
      }
      return;
    }
    restore(state);
    if (state.selection !== prev.selection || state.root !== prev.root) {
      reveal(state.selection?.nodeId);
    }
    if (state.root !== prev.root) {
      // Child index paths change when nodes move.
      persist();
    }
  });

  const unsubscribeCollapse = collapse.subscribe((state, prev) => {
    if (state.collapsed === prev.collapsed) {
      return;
    }
    persist();
    const { root, selection } = tree.getState();
    if (root && selection) {
      const hiding = hiddenBy(root, selection.nodeId, state.collapsed);
      if (hiding.length > 0) {
        tree.getState().select({ kind: 'node', nodeId: hiding[0] });
      }
    }
  });

  const unsubscribeViewport = viewport.subscribe((state, prev) => {
    if (state.focusSeq !== prev.focusSeq) {
      reveal(state.focusNodeId);
    }
  });

  return () => {
    unsubscribeTree();
    unsubscribeCollapse();
    unsubscribeViewport();
  };
}
