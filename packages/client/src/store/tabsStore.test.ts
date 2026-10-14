import { createIdGen, type TreeNodeJson } from '@owlbt/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewTransform } from '../components/TreeCanvas/viewportStore';
import { TREE_JSON } from '../test/fixtures';
import { alertStore } from './alertStore';
import {
  createTabsStore,
  readPersistedTabs,
  samePath,
  TABS_STORAGE_KEY,
  type PersistedTabs,
} from './tabsStore';
import { createTreeStore } from './treeStore';

const A = '/p/a.json';
const B = '/p/b.json';
const C = '/p/c.json';

function treeFor(path: string): TreeNodeJson {
  return { ...structuredClone(TREE_JSON), label: path };
}

function setup(persisted: PersistedTabs = { paths: [] }) {
  const saveTreeApi = vi.fn(async () => undefined);
  const tree = createTreeStore({
    fetchTree: vi.fn(async (path: string) => treeFor(path)),
    saveTree: saveTreeApi,
    idGen: createIdGen('t'),
  });
  let view: ViewTransform | undefined;
  const requested: Array<[string, ViewTransform | undefined]> = [];
  const persist = vi.fn();
  const beforeSwitch = vi.fn();
  const saveTree = vi.fn(async () => undefined);
  const tabs = createTabsStore({
    tree,
    saveTree,
    beforeSwitch,
    getViewTransform: () => view,
    requestViewTransform: (path, transform) => requested.push([path, transform]),
    loadPersisted: () => persisted,
    persist,
    notify: { error: vi.fn(), success: vi.fn() },
  });
  const setView = (next: ViewTransform | undefined) => {
    view = next;
  };
  /** Waits for pending loads. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const editLabel = (label: string) =>
    tree.getState().apply('Edit', (draft) => {
      draft.label = label;
    });
  const tabId = (path: string) => tabs.getState().tabs.find((tab) => tab.path === path)!.id;
  return {
    tree,
    tabs,
    persist,
    beforeSwitch,
    saveTree,
    saveTreeApi,
    requested,
    setView,
    settle,
    editLabel,
    tabId,
  };
}

describe('tabsStore', () => {
  beforeEach(() => {
    alertStore.getState().clear();
    window.localStorage.clear();
  });

  it('opens a tab per tree and activates an already open tree instead of adding it twice', async () => {
    const ctx = setup();
    ctx.tabs.getState().open(A);
    await ctx.settle();
    expect(ctx.tree.getState().treePath).toBe(A);
    ctx.tabs.getState().open(B);
    await ctx.settle();
    ctx.tabs.getState().open(A);
    await ctx.settle();
    expect(ctx.tabs.getState().tabs.map((tab) => tab.path)).toEqual([A, B]);
    expect(ctx.tabs.getState().activeId).toBe(ctx.tabId(A));
    expect(ctx.tree.getState().treePath).toBe(A);
    expect(ctx.tabs.getState().live).toBe(true);
  });

  it('opens new tabs right of the active one', async () => {
    const ctx = setup();
    ctx.tabs.getState().open(A);
    ctx.tabs.getState().open(B);
    ctx.tabs.getState().activate(ctx.tabId(A));
    ctx.tabs.getState().open(C);
    await ctx.settle();
    expect(ctx.tabs.getState().tabs.map((tab) => tab.path)).toEqual([A, C, B]);
  });

  it('keeps tree, selection, undo/redo, dirty flag and viewport per tab', async () => {
    const ctx = setup();
    ctx.tabs.getState().open(A);
    await ctx.settle();
    const root = ctx.tree.getState().root!;
    ctx.editLabel('first');
    ctx.editLabel('second');
    ctx.tree.getState().undo();
    ctx.tree.getState().select({ kind: 'node', nodeId: root.id });
    ctx.setView({ x: 10, y: 20, k: 0.5 });

    ctx.tabs.getState().open(B);
    await ctx.settle();
    expect(ctx.beforeSwitch).toHaveBeenCalledTimes(1);
    expect(ctx.tree.getState().root?.label).toBe(B);
    expect(ctx.tree.getState().dirty).toBe(false);
    expect(ctx.tree.getState().undoStack).toEqual([]);
    expect(ctx.tabs.getState().tabs.map((tab) => tab.dirty)).toEqual([true, false]);
    ctx.setView({ x: 0, y: 0, k: 1 });

    ctx.tabs.getState().activate(ctx.tabId(A));
    const state = ctx.tree.getState();
    expect(state.treePath).toBe(A);
    expect(state.root?.label).toBe('first');
    expect(state.selection).toEqual({ kind: 'node', nodeId: root.id });
    expect(state.undoStack).toHaveLength(1);
    expect(state.redoStack).toHaveLength(1);
    expect(state.dirty).toBe(true);
    expect(ctx.requested.at(-1)).toEqual([A, { x: 10, y: 20, k: 0.5 }]);

    // The saved marker comes back too: undo to the loaded state is clean again.
    ctx.tree.getState().undo();
    expect(ctx.tree.getState().dirty).toBe(false);
    expect(ctx.tabs.getState().tabs[0]?.dirty).toBe(false);
    ctx.tree.getState().redo();
    expect(ctx.tabs.getState().tabs[0]?.dirty).toBe(true);
  });

  it('reloads a tab whose tree was still loading when it was left', async () => {
    const ctx = setup();
    ctx.tabs.getState().open(A);
    ctx.tabs.getState().open(B); // A has not loaded yet
    await ctx.settle();
    expect(ctx.tree.getState().treePath).toBe(B);
    expect(ctx.tree.getState().root?.label).toBe(B);
    ctx.tabs.getState().activate(ctx.tabId(A));
    await ctx.settle();
    expect(ctx.tree.getState().root?.label).toBe(A);
  });

  it('cycles through the tabs in both directions', async () => {
    const ctx = setup();
    ctx.tabs.getState().open(A);
    ctx.tabs.getState().open(B);
    ctx.tabs.getState().open(C);
    await ctx.settle();
    ctx.tabs.getState().cycle(1);
    expect(ctx.tabs.getState().activeId).toBe(ctx.tabId(A));
    ctx.tabs.getState().cycle(-1);
    expect(ctx.tabs.getState().activeId).toBe(ctx.tabId(C));
  });

  it('closes a clean tab without asking and activates its neighbor', async () => {
    const ctx = setup();
    ctx.tabs.getState().open(A);
    ctx.tabs.getState().open(B);
    ctx.tabs.getState().open(C);
    await ctx.settle();
    ctx.tabs.getState().activate(ctx.tabId(B));
    await ctx.settle();
    await expect(ctx.tabs.getState().close(ctx.tabId(B))).resolves.toBe(true);
    expect(ctx.tabs.getState().tabs.map((tab) => tab.path)).toEqual([A, C]);
    expect(ctx.tabs.getState().activeId).toBe(ctx.tabId(C));
    expect(ctx.tree.getState().treePath).toBe(C);

    await ctx.tabs.getState().close(ctx.tabId(A)); // inactive
    await ctx.tabs.getState().close(ctx.tabId(C));
    expect(ctx.tabs.getState().tabs).toEqual([]);
    expect(ctx.tabs.getState().activeId).toBeUndefined();
  });

  it('asks before closing a dirty tab: cancel keeps it, discard closes it', async () => {
    const ctx = setup();
    ctx.tabs.getState().open(A);
    await ctx.settle();
    ctx.editLabel('changed');
    const id = ctx.tabId(A);

    const cancelled = ctx.tabs.getState().close(id);
    expect(ctx.tabs.getState().closePrompt).toEqual({ tabId: id });
    ctx.tabs.getState().answerClose('cancel');
    await expect(cancelled).resolves.toBe(false);
    expect(ctx.tabs.getState().closePrompt).toBeUndefined();
    expect(ctx.tabs.getState().tabs).toHaveLength(1);

    const discarded = ctx.tabs.getState().close(id);
    ctx.tabs.getState().answerClose('discard');
    await expect(discarded).resolves.toBe(true);
    expect(ctx.tabs.getState().tabs).toHaveLength(0);
    expect(ctx.saveTreeApi).not.toHaveBeenCalled();
  });

  it('saves the active tab through the tree store when Save is chosen', async () => {
    const ctx = setup();
    ctx.tabs.getState().open(A);
    await ctx.settle();
    ctx.editLabel('changed');
    const closing = ctx.tabs.getState().close(ctx.tabId(A));
    ctx.tabs.getState().answerClose('save');
    await expect(closing).resolves.toBe(true);
    expect(ctx.saveTreeApi).toHaveBeenCalledWith(A, expect.objectContaining({ label: 'changed' }));
  });

  it('keeps a dirty tab open when saving it fails', async () => {
    const ctx = setup();
    ctx.tabs.getState().open(A);
    ctx.tabs.getState().open(B);
    await ctx.settle();
    ctx.tabs.getState().activate(ctx.tabId(A));
    await ctx.settle();
    expect(ctx.editLabel('changed')).toBe(true);
    ctx.tabs.getState().activate(ctx.tabId(B));
    ctx.saveTree.mockRejectedValueOnce(new Error('disk full'));
    const closing = ctx.tabs.getState().close(ctx.tabId(A));
    ctx.tabs.getState().answerClose('save');
    await expect(closing).resolves.toBe(false);
    expect(ctx.tabs.getState().tabs).toHaveLength(2);
  });

  it('saves inactive dirty tabs from their snapshot (Save all)', async () => {
    const ctx = setup();
    ctx.tabs.getState().open(A);
    await ctx.settle();
    ctx.editLabel('a changed');
    ctx.tabs.getState().open(B);
    await ctx.settle();
    ctx.editLabel('b changed');

    await expect(ctx.tabs.getState().saveAll()).resolves.toBe(true);
    expect(ctx.saveTree).toHaveBeenCalledWith(A, expect.objectContaining({ label: 'a changed' }));
    expect(ctx.saveTreeApi).toHaveBeenCalledWith(
      B,
      expect.objectContaining({ label: 'b changed' }),
    );
    expect(ctx.tabs.getState().tabs.every((tab) => !tab.dirty)).toBe(true);

    // The saved snapshot is clean when it comes back, and a new edit makes it dirty again.
    ctx.tabs.getState().activate(ctx.tabId(A));
    expect(ctx.tree.getState().dirty).toBe(false);
    ctx.editLabel('again');
    expect(ctx.tree.getState().dirty).toBe(true);
  });

  it('parks the active tab while the editor is not shown and restores it afterwards', async () => {
    const ctx = setup();
    ctx.tabs.getState().open(A);
    await ctx.settle();
    ctx.editLabel('changed');
    ctx.tabs.getState().detach();
    expect(ctx.tabs.getState().live).toBe(false);
    await ctx.tree.getState().load(B); // something else used the tree store meanwhile
    ctx.tabs.getState().open(A);
    expect(ctx.tree.getState().root?.label).toBe('changed');
    expect(ctx.tree.getState().dirty).toBe(true);
  });

  it('persists the open tabs and restores them once', async () => {
    const ctx = setup({ paths: [A, B], active: B });
    ctx.tabs.getState().init();
    expect(ctx.tabs.getState().tabs.map((tab) => tab.path)).toEqual([A, B]);
    expect(ctx.tabs.getState().activeId).toBe(ctx.tabId(B));
    expect(ctx.tabs.getState().live).toBe(false);

    ctx.tabs.getState().open(C);
    await ctx.settle();
    expect(ctx.persist).toHaveBeenLastCalledWith({ paths: [A, B, C], active: C });

    ctx.tabs.getState().init(); // no second restore
    expect(ctx.tabs.getState().tabs).toHaveLength(3);
  });

  it('reads persisted tabs defensively', () => {
    expect(readPersistedTabs()).toEqual({ paths: [] });
    window.localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify({ paths: [A, 3, ''], active: A }));
    expect(readPersistedTabs()).toEqual({ paths: [A], active: A });
    window.localStorage.setItem(TABS_STORAGE_KEY, 'not json');
    expect(readPersistedTabs()).toEqual({ paths: [] });
  });

  it('compares paths with either slash', () => {
    expect(samePath('C:\\p\\a.json', 'C:/p/a.json')).toBe(true);
    expect(samePath('/p/a.json', '/p/b.json')).toBe(false);
  });
});
