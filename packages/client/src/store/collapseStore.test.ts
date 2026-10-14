import type { TreeNodeJson } from '@owlbt/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStore } from 'zustand/vanilla';
import type { ViewportState } from '../components/TreeCanvas/viewportStore';
import {
  collapseAllIds,
  collapseStorageKey,
  connectCollapse,
  createCollapseStore,
  type CollapseStore,
} from './collapseStore';
import { createTreeStore, type TreeStore } from './treeStore';

/** root: [a: [a1, a2: [x]], b] */
const JSON_TREE: TreeNodeJson = {
  type: 'Root',
  childNodes: [
    { type: 'A', childNodes: [{ type: 'A1' }, { type: 'A2', childNodes: [{ type: 'X' }] }] },
    { type: 'B' },
  ],
};

function createViewport() {
  return createStore<ViewportState>()((set) => ({
    focusSeq: 0,
    focusNode(nodeId) {
      set((state) => ({ focusSeq: state.focusSeq + 1, focusNodeId: nodeId }));
    },
  }));
}

describe('connectCollapse', () => {
  let tree: TreeStore;
  let collapse: CollapseStore;
  let viewport: ReturnType<typeof createViewport>;
  let disconnect: () => void;

  async function load(path = 'trees/a.json'): Promise<void> {
    await tree.getState().load(path);
  }

  function ids() {
    const root = tree.getState().root!;
    const a = root.childNodes[0];
    return {
      root,
      a,
      a2: a.childNodes[1],
      x: a.childNodes[1].childNodes[0],
      b: root.childNodes[1],
    };
  }

  beforeEach(() => {
    window.localStorage.clear();
    tree = createTreeStore({
      fetchTree: () => Promise.resolve(structuredClone(JSON_TREE)),
      saveTree: () => Promise.resolve(),
    });
    collapse = createCollapseStore();
    viewport = createViewport();
    disconnect = connectCollapse(tree, collapse, viewport);
  });

  afterEach(() => disconnect());

  it('persists collapsed nodes per tree path as child index paths', async () => {
    await load();
    const { a2 } = ids();
    collapse.getState().toggle(a2.id);
    expect(JSON.parse(window.localStorage.getItem(collapseStorageKey('trees/a.json'))!)).toEqual([
      '0.1',
    ]);
    collapse.getState().toggle(a2.id);
    expect(window.localStorage.getItem(collapseStorageKey('trees/a.json'))).toBeNull();
  });

  it('restores the persisted state on load', async () => {
    window.localStorage.setItem(collapseStorageKey('trees/a.json'), JSON.stringify(['0', 'bad']));
    await load();
    expect([...collapse.getState().collapsed]).toEqual([ids().a.id]);
    // Another tree has its own state.
    await load('trees/b.json');
    expect(collapse.getState().collapsed.size).toBe(0);
  });

  it('updates the persisted paths when nodes move', async () => {
    await load();
    const { a2 } = ids();
    collapse.getState().toggle(a2.id);
    tree.getState().apply('reorder', (draft) => {
      draft.childNodes.reverse();
    });
    expect(JSON.parse(window.localStorage.getItem(collapseStorageKey('trees/a.json'))!)).toEqual([
      '1.1',
    ]);
  });

  it('expands collapsed ancestors when the selection moves inside', async () => {
    await load();
    const { a, a2, x } = ids();
    collapse.getState().collapse([a.id, a2.id]);
    tree.getState().select({ kind: 'node', nodeId: x.id });
    expect(collapse.getState().collapsed.size).toBe(0);
  });

  it('expands collapsed ancestors on focus requests', async () => {
    await load();
    const { a, x } = ids();
    collapse.getState().collapse([a.id]);
    viewport.getState().focusNode(x.id);
    expect(collapse.getState().collapsed.has(a.id)).toBe(false);
  });

  it('selects the collapsed node when collapsing hides the selection', async () => {
    await load();
    const { a, x } = ids();
    tree.getState().select({ kind: 'node', nodeId: x.id });
    collapse.getState().toggle(a.id);
    expect(collapse.getState().collapsed.has(a.id)).toBe(true);
    expect(tree.getState().selection).toEqual({ kind: 'node', nodeId: a.id });
  });

  it('collapse all keeps the root expanded', async () => {
    await load();
    const { root, a, a2 } = ids();
    expect(collapseAllIds(root)).toEqual([a.id, a2.id]);
  });
});
