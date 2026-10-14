import {
  compileProject,
  createIdGen,
  nodeFromJson,
  type SubtreeLibrary,
  type TreeNode,
  type TreeNodeJson,
} from '@owlbt/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubtreeResolution } from '../lib/api';
import { createProjectStore } from './projectStore';
import { createSubtreeStore, startSubtreeSync, SUBTREE_SYNC_DELAY } from './subtreeStore';
import { createTreeStore } from './treeStore';

const project = compileProject({
  nodes: [
    { name: 'Sequence', isComposite: true },
    { name: 'Act' },
    { name: 'SubTree', subtree: true },
  ],
});

const ref = (path: string): TreeNodeJson => ({
  type: 'SubTree',
  properties: [{ name: 'Tree', value: path }],
});

const LIBRARY: SubtreeLibrary = {
  'trees/a.json': { path: '/p/trees/a.json', tree: { type: 'Act' } },
  'trees/loop.json': { path: '/p/trees/loop.json', tree: ref('trees/main.json') },
  'trees/none.json': { error: 'missing', message: "Referenced tree 'trees/none.json' not found" },
};

function setup(json: TreeNodeJson) {
  let root: TreeNode = nodeFromJson(json, createIdGen('n'));
  const resolve = vi.fn(
    async (_path: string, refs?: readonly string[]): Promise<SubtreeResolution> => {
      const library: SubtreeLibrary = {};
      for (const r of refs ?? []) {
        if (LIBRARY[r]) library[r] = LIBRARY[r];
      }
      return { projectDir: '/p', self: 'trees/main.json', library };
    },
  );
  const store = createSubtreeStore({
    resolve,
    getTree: () => ({ root, treePath: '/p/trees/main.json' }),
    getProject: () => project,
  });
  return {
    store,
    resolve,
    root: () => root,
    setRoot: (next: TreeNodeJson) => {
      root = nodeFromJson(next, createIdGen('m'));
    },
  };
}

describe('subtreeStore', () => {
  it('loads the references of the open tree and reports their problems', async () => {
    const { store, resolve, root } = setup({
      type: 'Sequence',
      childNodes: [ref('trees/a.json'), ref('trees/none.json'), ref('trees/loop.json'), ref('')],
    });
    await store.getState().sync();
    expect(resolve).toHaveBeenCalledWith('/p/trees/main.json', [
      'trees/a.json',
      'trees/none.json',
      'trees/loop.json',
    ]);
    const state = store.getState();
    expect(state.projectDir).toBe('/p');
    expect(state.self).toBe('trees/main.json');
    const ids = root().childNodes.map((child) => child.id);
    expect(state.problems.has(ids[0])).toBe(false);
    expect(state.problems.get(ids[1])?.kind).toBe('missing');
    expect(state.problems.get(ids[2])?.message).toBe(
      'Subtree cycle: trees/main.json → trees/loop.json → trees/main.json',
    );
    expect(state.problems.get(ids[3])?.kind).toBe('empty');

    // Nothing new to load.
    await store.getState().sync();
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('does not report references that are still loading', () => {
    const { store, root } = setup({ type: 'Sequence', childNodes: [ref('trees/a.json')] });
    store.getState().recompute();
    expect(store.getState().problems.has(root().childNodes[0].id)).toBe(false);
  });

  it('loads only new references on sync and everything on refresh', async () => {
    const { store, resolve, setRoot } = setup({ type: 'Sequence', childNodes: [ref('trees/a')] });
    await store.getState().sync();
    setRoot({ type: 'Sequence', childNodes: [ref('trees/a'), ref('trees/none')] });
    await store.getState().sync();
    expect(resolve).toHaveBeenLastCalledWith('/p/trees/main.json', ['trees/none.json']);
    expect(Object.keys(store.getState().library).sort()).toEqual([
      'trees/a.json',
      'trees/none.json',
    ]);

    setRoot({ type: 'Sequence', childNodes: [ref('trees/a')] });
    expect(await store.getState().refresh()).toBe(true);
    expect(Object.keys(store.getState().library)).toEqual(['trees/a.json']);
    expect(await store.getState().refresh()).toBe(false);
  });

  it('keeps the error of a failed request', async () => {
    const store = createSubtreeStore({
      resolve: vi.fn(async () => {
        throw new Error('offline');
      }),
      getTree: () => ({
        root: nodeFromJson(ref('trees/a.json'), createIdGen()),
        treePath: '/p/t.json',
      }),
      getProject: () => project,
    });
    await store.getState().sync();
    expect(store.getState().error).toBe('offline');
    expect(store.getState().loading).toBe(false);
  });
});

describe('startSubtreeSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads new references shortly after the tree changes and stops on cleanup', async () => {
    const trees = createTreeStore({
      fetchTree: async () => ({ type: 'Sequence', childNodes: [ref('trees/a.json')] }),
      saveTree: async () => undefined,
    });
    const projects = createProjectStore({
      fetchProject: async () => JSON.stringify({ nodes: [{ name: 'SubTree', subtree: true }] }),
      createSocket: () => ({ on: () => undefined, disconnect: () => undefined }),
    });
    const resolve = vi.fn(async (): Promise<SubtreeResolution> => ({
      projectDir: '/p',
      self: 'trees/main.json',
      library: { 'trees/a.json': LIBRARY['trees/a.json'] },
    }));
    const store = createSubtreeStore({
      resolve,
      getTree: () => trees.getState(),
      getProject: () => projects.getState().project,
    });

    const stop = startSubtreeSync('/p/trees/main.json', store, trees, projects);
    await projects.getState().load('/p/trees/main.json');
    await trees.getState().load('/p/trees/main.json');
    await vi.advanceTimersByTimeAsync(SUBTREE_SYNC_DELAY + 10);
    expect(store.getState().library['trees/a.json']).toBeDefined();

    stop();
    expect(store.getState().library).toEqual({});
    expect(store.getState().treePath).toBeUndefined();
  });
});
