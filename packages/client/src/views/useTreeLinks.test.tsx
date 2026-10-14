import { act, cleanup, renderHook } from '@testing-library/react';
import { createIdGen, nodeFromJson } from '@owlbt/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDirtyTreePaths } from '../lib/dirtyTrees';
import { treeStore } from '../store/treeStore';
import { useDirtyTreeBeacon, useSelectFromUrl } from './useTreeLinks';

function loadTree() {
  const root = nodeFromJson(
    { type: 'Seq', childNodes: [{ type: 'A' }, { type: 'B', services: [{ type: 'S' }] }] },
    createIdGen('u'),
  );
  treeStore.setState((state) => ({
    root,
    selection: undefined,
    dirty: false,
    loadCount: state.loadCount + 1,
  }));
  return root;
}

describe('useSelectFromUrl', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    cleanup();
  });

  it('selects the item of the URL once the tree has loaded', () => {
    treeStore.setState({ root: undefined, loadCount: 0, selection: undefined });
    const { rerender } = renderHook(({ select }) => useSelectFromUrl(select), {
      initialProps: { select: 'service:1:0' as string | undefined },
    });
    expect(treeStore.getState().selection).toBeUndefined();

    let root = loadTree();
    act(() => rerender({ select: 'service:1:0' }));
    expect(treeStore.getState().selection).toEqual({
      kind: 'service',
      nodeId: root.childNodes[1].id,
      itemId: root.childNodes[1].services[0].id,
    });

    // A new value selects again (same tree, another usage).
    act(() => rerender({ select: 'node:0' }));
    root = treeStore.getState().root ?? root;
    expect(treeStore.getState().selection).toEqual({ kind: 'node', nodeId: root.childNodes[0].id });
  });

  it('ignores values that do not match the tree', () => {
    loadTree();
    renderHook(() => useSelectFromUrl('node:7'));
    expect(treeStore.getState().selection).toBeUndefined();
  });
});

describe('useDirtyTreeBeacon', () => {
  it('publishes the unsaved state of the open tree', () => {
    window.localStorage.clear();
    treeStore.setState({ dirty: false });
    const { unmount } = renderHook(() => useDirtyTreeBeacon('/p/t.json'));
    expect(getDirtyTreePaths()).toEqual([]);
    act(() => treeStore.setState({ dirty: true }));
    expect(getDirtyTreePaths()).toEqual(['/p/t.json']);
    unmount();
    expect(getDirtyTreePaths()).toEqual([]);
  });
});
