import { nodeToJson, type TreeNodeJson } from '@owlbt/shared';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import {
  getViewTransform,
  requestViewTransform,
  type ViewTransform,
} from '../components/TreeCanvas/viewportStore';
import { saveTree } from '../lib/api';
import { getJson, setJson } from '../lib/storage';
import { alerts } from './alertStore';
import { inspectStore } from './inspectStore';
import { runStore } from './runStore';
import { treeStore, type TreeSnapshot, type TreeStore } from './treeStore';
import { t } from '../i18n';

/** localStorage key of the open tabs (paths and the active one). */
export const TABS_STORAGE_KEY = 'owlbt.editorTabs';

/** One open tree of the editor. */
export interface EditorTab {
  id: string;
  path: string;
  dirty: boolean;
}

export type CloseChoice = 'save' | 'discard' | 'cancel';

export interface PersistedTabs {
  paths: string[];
  active?: string;
}

export interface TabsState {
  tabs: EditorTab[];
  activeId?: string;
  /**
   * True while the tree store holds the active tab (the editor is shown). Inactive tabs, and the
   * active one while the editor is not shown, are kept as snapshots.
   */
  live: boolean;
  /** The tab whose close waits for the Save / Discard / Cancel answer. */
  closePrompt?: { tabId: string };

  /** Restores the tabs persisted by the last session (once per page load). */
  init(): void;
  /** Activates the tab of the path, adding one when the tree is not open yet. */
  open(path: string): void;
  activate(id: string): void;
  /** Activates the next (1) or previous (-1) tab, wrapping around. */
  cycle(delta: 1 | -1): void;
  /** Closes a tab; a dirty one asks first. Resolves false when the close was cancelled or the save failed. */
  close(id: string): Promise<boolean>;
  /** Answers the open close prompt. */
  answerClose(choice: CloseChoice): void;
  /** Saves every dirty tab. Resolves true when all saves succeeded. */
  saveAll(): Promise<boolean>;
  /** Moves the active tab out of the tree store (the editor is left). */
  detach(): void;
}

export interface TabsStoreDeps {
  tree: TreeStore;
  saveTree: (treePath: string, json: TreeNodeJson) => Promise<void>;
  /** Called before another tab is shown (exits run mode, closes the type inspection). */
  beforeSwitch(): void;
  getViewTransform(): ViewTransform | undefined;
  requestViewTransform(treePath: string, transform: ViewTransform | undefined): void;
  loadPersisted(): PersistedTabs;
  persist(tabs: PersistedTabs): void;
  notify: { error(message: string): void; success(message: string): void };
}

/** Same file, accepting either slash as separator. */
export function samePath(a: string, b: string): boolean {
  return a.replace(/\\/g, '/') === b.replace(/\\/g, '/');
}

export function readPersistedTabs(): PersistedTabs {
  const stored = getJson<unknown>(TABS_STORAGE_KEY, undefined);
  if (typeof stored !== 'object' || stored === null) {
    return { paths: [] };
  }
  const { paths, active } = stored as { paths?: unknown; active?: unknown };
  return {
    paths: Array.isArray(paths)
      ? paths.filter((path): path is string => typeof path === 'string' && path !== '')
      : [],
    active: typeof active === 'string' ? active : undefined,
  };
}

const defaultDeps: TabsStoreDeps = {
  tree: treeStore,
  saveTree,
  beforeSwitch() {
    runStore.getState().exit();
    inspectStore.getState().clear();
  },
  getViewTransform,
  requestViewTransform,
  loadPersisted: readPersistedTabs,
  persist: (tabs) => setJson(TABS_STORAGE_KEY, tabs),
  notify: {
    error: (message) => void alerts.error(message),
    success: (message) => void alerts.success(message),
  },
};

interface TabData {
  snapshot?: TreeSnapshot;
  view?: ViewTransform;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createTabsStore(overrides: Partial<TabsStoreDeps> = {}) {
  const deps: TabsStoreDeps = { ...defaultDeps, ...overrides };
  const { tree } = deps;

  const store = createStore<TabsState>()((set, get) => {
    let nextId = 1;
    let initialized = false;
    /** Snapshots of the tabs that are not in the tree store, by tab id. */
    const data = new Map<string, TabData>();
    let pendingClose: ((choice: CloseChoice) => void) | undefined;

    const newTab = (path: string): EditorTab => ({ id: `tab${nextId++}`, path, dirty: false });

    const find = (id: string | undefined): EditorTab | undefined =>
      id === undefined ? undefined : get().tabs.find((tab) => tab.id === id);

    const setDirty = (id: string, dirty: boolean): void => {
      if (find(id)?.dirty !== dirty) {
        set((state) => ({
          tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, dirty } : tab)),
        }));
      }
    };

    /** Stores the tree store's state in the active tab. */
    const park = (): void => {
      const active = find(get().activeId);
      if (!get().live || !active) {
        return;
      }
      const snapshot = tree.getState().snapshot();
      data.set(active.id, { snapshot, view: deps.getViewTransform() });
      setDirty(active.id, snapshot.data.dirty);
    };

    /** Puts the tab into the tree store: its snapshot, or a fresh load. */
    const show = (tab: EditorTab): void => {
      const saved = data.get(tab.id);
      data.delete(tab.id);
      set({ activeId: tab.id, live: true });
      if (saved?.snapshot?.data.root && samePath(saved.snapshot.data.treePath ?? '', tab.path)) {
        deps.requestViewTransform(tab.path, saved.view);
        tree.getState().restore(saved.snapshot);
      } else {
        deps.requestViewTransform(tab.path, undefined);
        void tree.getState().load(tab.path);
      }
      setDirty(tab.id, tree.getState().dirty);
    };

    const saveTab = async (tab: EditorTab): Promise<boolean> => {
      const state = get();
      if (state.live && state.activeId === tab.id) {
        return tree.getState().save();
      }
      const saved = data.get(tab.id);
      const root = saved?.snapshot?.data.root;
      if (!saved?.snapshot || !root) {
        return true; // Never loaded, so nothing to save.
      }
      try {
        await deps.saveTree(tab.path, nodeToJson(root));
      } catch (err) {
        deps.notify.error(errorText(err));
        return false;
      }
      const { undoStack } = saved.snapshot.data;
      saved.snapshot = {
        data: { ...saved.snapshot.data, dirty: false },
        savedTop: undoStack[undoStack.length - 1],
      };
      setDirty(tab.id, false);
      return true;
    };

    const remove = (id: string): void => {
      const state = get();
      const index = state.tabs.findIndex((tab) => tab.id === id);
      if (index < 0) {
        return;
      }
      data.delete(id);
      const tabs = state.tabs.filter((tab) => tab.id !== id);
      if (state.activeId !== id) {
        set({ tabs });
        return;
      }
      const next = tabs[Math.min(index, tabs.length - 1)];
      if (state.live) {
        deps.beforeSwitch();
      }
      set({ tabs, activeId: undefined });
      if (next && state.live) {
        show(next);
      } else if (next) {
        set({ activeId: next.id });
      }
    };

    return {
      tabs: [],
      live: false,

      init() {
        if (initialized) {
          return;
        }
        initialized = true;
        const persisted = deps.loadPersisted();
        const known = get().tabs;
        const tabs = [...known];
        for (const path of persisted.paths) {
          if (!tabs.some((tab) => samePath(tab.path, path))) {
            tabs.push(newTab(path));
          }
        }
        const active =
          find(get().activeId) ??
          tabs.find(
            (tab) => persisted.active !== undefined && samePath(tab.path, persisted.active),
          ) ??
          tabs[0];
        set({ tabs, activeId: active?.id });
      },

      open(path) {
        const existing = get().tabs.find((tab) => samePath(tab.path, path));
        if (existing) {
          get().activate(existing.id);
          return;
        }
        const tab = newTab(path);
        set((state) => {
          // New tabs open right of the active one.
          const index = state.tabs.findIndex((item) => item.id === state.activeId);
          const tabs = [...state.tabs];
          tabs.splice(index < 0 ? tabs.length : index + 1, 0, tab);
          return { tabs };
        });
        get().activate(tab.id);
      },

      activate(id) {
        const state = get();
        const tab = find(id);
        if (!tab || (state.live && state.activeId === id)) {
          return;
        }
        if (state.live) {
          deps.beforeSwitch();
          park();
        }
        show(tab);
      },

      cycle(delta) {
        const { tabs, activeId } = get();
        if (tabs.length < 2) {
          return;
        }
        const index = tabs.findIndex((tab) => tab.id === activeId);
        const next = tabs[(index + delta + tabs.length) % tabs.length];
        if (next) {
          get().activate(next.id);
        }
      },

      async close(id) {
        const tab = find(id);
        if (!tab) {
          return false;
        }
        if (tab.dirty) {
          pendingClose?.('cancel');
          const choice = await new Promise<CloseChoice>((resolve) => {
            pendingClose = resolve;
            set({ closePrompt: { tabId: id } });
          });
          if (choice === 'cancel') {
            return false;
          }
          const current = find(id);
          if (!current) {
            return true;
          }
          if (choice === 'save' && !(await saveTab(current))) {
            return false;
          }
        }
        remove(id);
        return true;
      },

      answerClose(choice) {
        const resolve = pendingClose;
        pendingClose = undefined;
        set({ closePrompt: undefined });
        resolve?.(choice);
      },

      async saveAll() {
        let ok = true;
        let others = 0;
        for (const tab of get().tabs) {
          if (!tab.dirty) {
            continue;
          }
          const isActive = get().live && get().activeId === tab.id;
          if (!(await saveTab(tab))) {
            ok = false;
          } else if (!isActive) {
            others++;
          }
        }
        if (others > 0) {
          deps.notify.success(
            others === 1
              ? t('Saved 1 other tree')
              : t('Saved {count} other trees', { count: others }),
          );
        }
        return ok;
      },

      detach() {
        park();
        set({ live: false });
      },
    };
  });

  // The active tab follows the dirty flag of the tree store.
  tree.subscribe((state, prev) => {
    const { live, activeId, tabs } = store.getState();
    const active = tabs.find((tab) => tab.id === activeId);
    if (
      live &&
      active &&
      state.dirty !== prev.dirty &&
      state.treePath !== undefined &&
      samePath(state.treePath, active.path)
    ) {
      store.setState({
        tabs: tabs.map((tab) => (tab.id === active.id ? { ...tab, dirty: state.dirty } : tab)),
      });
    }
  });

  // Open tabs survive a reload of the page.
  store.subscribe((state, prev) => {
    if (state.tabs === prev.tabs && state.activeId === prev.activeId) {
      return;
    }
    const active = state.tabs.find((tab) => tab.id === state.activeId);
    deps.persist({ paths: state.tabs.map((tab) => tab.path), active: active?.path });
  });

  return store;
}

export type TabsStore = ReturnType<typeof createTabsStore>;

/** Application-wide editor tabs. */
export const tabsStore: TabsStore = createTabsStore();

export function useTabsStore<T>(selector: (state: TabsState) => T): T {
  return useStore(tabsStore, selector);
}

export function selectActiveTab(
  state: Pick<TabsState, 'tabs' | 'activeId'>,
): EditorTab | undefined {
  return state.tabs.find((tab) => tab.id === state.activeId);
}

export function selectAnyDirty(state: Pick<TabsState, 'tabs'>): boolean {
  return state.tabs.some((tab) => tab.dirty);
}
