import { applyPatches, enablePatches, produceWithPatches, type Patch } from 'immer';
import {
  createIdGen,
  findNode,
  findSubItem,
  isTreeValid,
  nodeFromJson,
  nodeToJson,
  type CompiledProject,
  type IdGen,
  type Selection,
  type SubItem,
  type TreeNode,
  type TreeNodeJson,
} from '@owlbt/shared';
import { useMemo } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { fetchTree, saveTree } from '../lib/api';
import { alerts } from './alertStore';
import { t } from '../i18n';

enablePatches();

export const UNDO_STACK_LIMIT = 100;

/** Saved marker meaning the state at the bottom of the undo stack (undoStack.length === 0). */
export const INITIAL_SAVED = Symbol('initial-saved');
/** Saved marker meaning the saved state was trimmed out of history and cannot be reached by undo. */
export const UNREACHABLE_SAVED = Symbol('unreachable-saved');

export type SavedMarker = HistoryEntry | typeof INITIAL_SAVED | typeof UNREACHABLE_SAVED;

export interface HistoryEntry {
  label: string;
  patches: Patch[];
  inversePatches: Patch[];
  selectionBefore?: Selection;
  selectionAfter?: Selection;
}

export type SelectionArg = Selection | ((draft: TreeNode) => Selection | undefined);

/** The data fields of the tree state (everything but the actions). */
export type TreeStateData = {
  [
    K in keyof TreeState as TreeState[K] extends (...args: never[]) => unknown ? never : K
  ]: TreeState[K];
};

/**
 * Copy of a tree store's state, including its saved marker. Editor tabs keep one per inactive tree
 * and put it back with `restore`.
 */
export interface TreeSnapshot {
  data: TreeStateData;
  /** Undo-stack marker when the tree was loaded or last saved (see `dirty`). */
  savedTop: SavedMarker;
  /** Number of undo trims observed for this tree (guards `INITIAL_SAVED` across async saves). */
  trimCount: number;
}

export interface TreeState {
  treePath?: string;
  root?: TreeNode;
  selection?: Selection;
  dirty: boolean;
  /** Increments on every change of the tree (edits, undo, redo, load). */
  version: number;
  /** Increments on every successful load. Lets views react to a (re)load only. */
  loadCount: number;
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  loading: boolean;
  error?: string;

  load(treePath: string): Promise<void>;
  /**
   * Applies `recipe` to the root as one undoable step. Does nothing (returns false) when the
   * recipe changes nothing. `nextSelection` is either a fixed value (undefined keeps the current
   * selection) or a function evaluated on the draft after the recipe ran.
   */
  apply(label: string, recipe: (draft: TreeNode) => void, nextSelection?: SelectionArg): boolean;
  undo(): void;
  redo(): void;
  select(selection?: Selection): void;
  /** Saves the tree. Returns true on success; errors are reported through the alert store. */
  save(): Promise<boolean>;
  /** Updates the saved marker (e.g. after an external or background tab save completes). */
  markSaved(savedAt: SavedMarker, savedTrimCount?: number): void;
  /** Resets the store to an empty unloaded state (e.g. after closing the last tab). */
  clear(): void;
  /** True when no item of the tree is invalid for the project (always true without a tree). */
  isValid(project: CompiledProject): boolean;
  getIdGen(): IdGen;
  /** Copies the current state (for editor tabs). */
  snapshot(): TreeSnapshot;
  /** Replaces the state by a snapshot. A pending load is cancelled. */
  restore(snapshot: TreeSnapshot): void;
}

export interface TreeStoreDeps {
  fetchTree: (treePath: string) => Promise<TreeNodeJson>;
  saveTree: (treePath: string, json: TreeNodeJson) => Promise<void>;
  idGen: IdGen;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The entry on top of an undo stack (the step that produced the current tree), undefined when empty. */
function topOf(stack: HistoryEntry[]): HistoryEntry | undefined {
  return stack[stack.length - 1];
}

/** True when the undo stack position matches the saved marker. */
export function isCleanHistory(undoStack: HistoryEntry[], marker: SavedMarker): boolean {
  if (marker === UNREACHABLE_SAVED) {
    return false;
  }
  if (marker === INITIAL_SAVED) {
    return undoStack.length === 0;
  }
  return topOf(undoStack) === marker;
}

export function createTreeStore(overrides: Partial<TreeStoreDeps> = {}) {
  const deps: TreeStoreDeps = {
    fetchTree,
    saveTree,
    idGen: createIdGen('n'),
    ...overrides,
  };

  return createStore<TreeState>()((set, get) => {
    let loadToken = 0;
    let saveSeq = 0;
    let completedSaveSeq = 0;
    let trimCount = 0;
    /**
     * Undo-stack marker when the tree was loaded or last saved. The tree is clean while the top
     * matches this marker again, so undo back to the saved state is clean, and a new edit after
     * an undo (or overflowing the history limit) is not.
     */
    let savedTop: SavedMarker = INITIAL_SAVED;

    const pushUndo = (stack: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] => {
      if (stack.length >= UNDO_STACK_LIMIT) {
        const dropped = stack[0];
        trimCount++;
        if (savedTop === INITIAL_SAVED || savedTop === dropped) {
          savedTop = UNREACHABLE_SAVED;
        }
        return [...stack.slice(stack.length - UNDO_STACK_LIMIT + 1), entry];
      }
      return [...stack, entry];
    };

    return {
      dirty: false,
      version: 0,
      loadCount: 0,
      undoStack: [],
      redoStack: [],
      loading: false,

      async load(treePath) {
        const token = ++loadToken;
        completedSaveSeq = saveSeq;
        trimCount = 0;
        savedTop = INITIAL_SAVED;
        set({
          treePath,
          root: undefined,
          selection: undefined,
          dirty: false,
          undoStack: [],
          redoStack: [],
          loading: true,
          error: undefined,
        });
        try {
          const json = await deps.fetchTree(treePath);
          if (token !== loadToken) {
            return;
          }
          const root = nodeFromJson(json, deps.idGen);
          trimCount = 0;
          savedTop = INITIAL_SAVED;
          set((state) => ({
            root,
            loading: false,
            version: state.version + 1,
            loadCount: state.loadCount + 1,
          }));
        } catch (err) {
          if (token !== loadToken) {
            return;
          }
          const message = errorText(err);
          set({ loading: false, error: message });
          alerts.error(t("Failed to load tree. Error = '{message}'", { message }));
        }
      },

      apply(label, recipe, nextSelection) {
        const state = get();
        const { root } = state;
        if (!root) {
          return false;
        }

        let resolvedAfter: Selection | undefined;
        const [nextRoot, patches, inversePatches] = produceWithPatches(root, (draft) => {
          recipe(draft);
          if (typeof nextSelection === 'function') {
            resolvedAfter = nextSelection(draft);
          }
        });
        if (patches.length === 0) {
          return false;
        }

        let selectionAfter: Selection | undefined;
        if (typeof nextSelection === 'function') {
          selectionAfter = resolvedAfter;
        } else {
          selectionAfter = nextSelection === undefined ? state.selection : nextSelection;
        }

        const entry: HistoryEntry = {
          label,
          patches,
          inversePatches,
          selectionBefore: state.selection,
          selectionAfter,
        };
        const undoStack = pushUndo(state.undoStack, entry);
        set({
          root: nextRoot,
          selection: selectionAfter,
          dirty: !isCleanHistory(undoStack, savedTop),
          version: state.version + 1,
          undoStack,
          redoStack: [],
        });
        return true;
      },

      undo() {
        const state = get();
        const entry = state.undoStack[state.undoStack.length - 1];
        if (!entry || !state.root) {
          return;
        }
        const undoStack = state.undoStack.slice(0, -1);
        set({
          root: applyPatches(state.root, entry.inversePatches),
          selection: entry.selectionBefore,
          dirty: !isCleanHistory(undoStack, savedTop),
          version: state.version + 1,
          undoStack,
          redoStack: [...state.redoStack, entry],
        });
      },

      redo() {
        const state = get();
        const entry = state.redoStack[state.redoStack.length - 1];
        if (!entry || !state.root) {
          return;
        }
        const undoStack = pushUndo(state.undoStack, entry);
        set({
          root: applyPatches(state.root, entry.patches),
          selection: entry.selectionAfter,
          dirty: !isCleanHistory(undoStack, savedTop),
          version: state.version + 1,
          undoStack,
          redoStack: state.redoStack.slice(0, -1),
        });
      },

      select(selection) {
        set({ selection });
      },

      markSaved(savedAt, savedTrimCount = trimCount) {
        const state = get();
        if (savedAt === UNREACHABLE_SAVED) {
          savedTop = UNREACHABLE_SAVED;
        } else if (savedAt === INITIAL_SAVED) {
          savedTop = trimCount === savedTrimCount ? INITIAL_SAVED : UNREACHABLE_SAVED;
        } else {
          const reachable =
            state.undoStack.includes(savedAt) || state.redoStack.includes(savedAt);
          savedTop = reachable ? savedAt : UNREACHABLE_SAVED;
        }
        set({ dirty: !isCleanHistory(state.undoStack, savedTop) });
      },

      async save() {
        const state = get();
        const { treePath, root } = state;
        if (!treePath || !root) {
          alerts.error(t('Unable to save before the tree is loaded'));
          return false;
        }
        const token = loadToken;
        const seq = ++saveSeq;
        const savedAt: SavedMarker = topOf(state.undoStack) ?? INITIAL_SAVED;
        const savedTrimCount = trimCount;
        try {
          await deps.saveTree(treePath, nodeToJson(root));
        } catch (err) {
          alerts.error(errorText(err));
          return false;
        }
        if (token === loadToken && seq > completedSaveSeq) {
          completedSaveSeq = seq;
          // Edits made while the request ran stay unsaved.
          get().markSaved(savedAt, savedTrimCount);
        }
        alerts.success(t('Done'));
        return true;
      },

      clear() {
        loadToken++;
        completedSaveSeq = saveSeq;
        trimCount = 0;
        savedTop = INITIAL_SAVED;
        set((state) => ({
          treePath: undefined,
          root: undefined,
          selection: undefined,
          dirty: false,
          version: state.version + 1,
          undoStack: [],
          redoStack: [],
          loading: false,
          error: undefined,
        }));
      },

      isValid(project) {
        const { root } = get();
        return root ? isTreeValid(root, project) : true;
      },

      getIdGen() {
        return deps.idGen;
      },

      snapshot() {
        const data: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(get())) {
          if (typeof value !== 'function') {
            data[key] = value;
          }
        }
        return { data: data as TreeStateData, savedTop, trimCount };
      },

      restore(snapshot) {
        loadToken++;
        completedSaveSeq = saveSeq;
        savedTop = snapshot.savedTop;
        trimCount = snapshot.trimCount;
        // version keeps increasing so that views see a change; loadCount is not a new load.
        set((state) => ({
          ...snapshot.data,
          version: Math.max(state.version, snapshot.data.version) + 1,
          loadCount: state.loadCount,
        }));
      },
    };
  });
}

export type TreeStore = ReturnType<typeof createTreeStore>;

/** Application-wide tree store. */
export const treeStore: TreeStore = createTreeStore();

export function selectCanUndo(state: Pick<TreeState, 'undoStack'>): boolean {
  return state.undoStack.length > 0;
}

export function selectCanRedo(state: Pick<TreeState, 'redoStack'>): boolean {
  return state.redoStack.length > 0;
}

export function useTreeStore<T>(selector: (state: TreeState) => T): T {
  return useStore(treeStore, selector);
}

/** The item selected in the tree: a node, or one of its decorators/services. */
export interface SelectedItem {
  kind: 'node' | 'decorator' | 'service';
  node: TreeNode;
  subItem?: SubItem;
}

/** Resolves a selection against a tree. Returns undefined when nothing (valid) is selected. */
export function getSelectedItem(
  root: TreeNode | undefined,
  selection: Selection | undefined,
): SelectedItem | undefined {
  if (!root || !selection) {
    return undefined;
  }
  const node = findNode(root, selection.nodeId);
  if (!node) {
    return undefined;
  }
  if (selection.kind === 'node') {
    return { kind: 'node', node };
  }
  const subItem = findSubItem(node, selection.kind, selection.itemId);
  return subItem ? { kind: selection.kind, node, subItem } : undefined;
}

/** Currently selected item (node or sub item) of the tree store. */
export function useSelectedItem(): SelectedItem | undefined {
  const root = useTreeStore((state) => state.root);
  const selection = useTreeStore((state) => state.selection);
  return useMemo(() => getSelectedItem(root, selection), [root, selection]);
}
