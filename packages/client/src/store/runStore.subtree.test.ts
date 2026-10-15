import {
  compileProject,
  createIdGen,
  nodeFromJson,
  type SubtreeLibrary,
  type TreeNodeJson,
} from '@owlbt/shared';
import { describe, expect, it, vi } from 'vitest';
import { createRunStore, type RunStoreDeps } from './runStore';

const project = compileProject({
  nodes: [
    { name: 'Sequence', isComposite: true },
    { name: 'Manual' },
    { name: 'Ok', simulate: { mode: 'success' } },
    { name: 'SubTree', subtree: true },
  ],
});

const TREE: TreeNodeJson = {
  type: 'Sequence',
  childNodes: [{ type: 'SubTree', properties: [{ name: 'Tree', value: 'trees/ask.json' }] }],
};

function setup(library: SubtreeLibrary, refreshed?: SubtreeLibrary) {
  const root = nodeFromJson(TREE, createIdGen('n'));
  let current = library;
  const deps: Partial<RunStoreDeps> = {
    getTree: () => ({ root, treePath: '/p/trees/main.json' }),
    getProject: () => project,
    getScenarios: () => [],
    focus: vi.fn(),
    select: vi.fn(),
    getSubtrees: () => ({ library: current, treeRef: 'trees/main.json' }),
    refreshSubtrees: vi.fn(async () => {
      if (!refreshed) return false;
      current = refreshed;
      return true;
    }),
  };
  return { store: createRunStore(deps), deps, root };
}

describe('runStore with subtrees', () => {
  it('runs referenced trees and selects their subtree node for manual results', () => {
    const { store, deps, root } = setup({
      'trees/ask.json': { tree: { type: 'Manual', label: 'Ask' } },
    });
    expect(store.getState().enter()).toBe(true);
    const subNode = root.childNodes[0];
    expect(store.getState().runRoot?.childNodes[0].childNodes[0].label).toBe('Ask');

    store.getState().step();
    const latest = store.getState().history.at(-1);
    expect(latest?.pendingManual).toBe(`${subNode.id}/1`);
    expect(deps.select).toHaveBeenLastCalledWith({ kind: 'node', nodeId: subNode.id });
    expect(deps.focus).toHaveBeenLastCalledWith(subNode.id);

    store.getState().resolveManual('success');
    store.getState().step();
    expect(store.getState().history.at(-1)?.finished).toBe('success');

    store.getState().exit();
    expect(store.getState().runRoot).toBeUndefined();
  });

  it('reloads the referenced trees when entering and rebuilds the fresh run', async () => {
    const { store, deps } = setup(
      {},
      { 'trees/ask.json': { tree: { type: 'Ok', label: 'Fresh' } } },
    );
    store.getState().enter();
    expect(deps.refreshSubtrees).toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(store.getState().runRoot?.childNodes[0].childNodes[0]?.label).toBe('Fresh'),
    );
    store.getState().step();
    expect(store.getState().history.at(-1)?.finished).toBe('success');
  });
});
