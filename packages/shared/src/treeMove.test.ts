import { describe, expect, it } from 'vitest';
import { findNode } from './treeOps';
import {
  isNoopNodeDrop,
  isNoopSubItemDrop,
  isSameOrDescendant,
  moveNodeTo,
  moveSubItemTo,
  resolveNodeDrop,
  resolveSubItemDrop,
} from './treeMove';
import type { SubItem, TreeNode } from './types';

function sub(id: string): SubItem {
  return { id, type: 's', properties: {}, extra: {} };
}

function node(id: string, childNodes: TreeNode[] = [], extra: Partial<TreeNode> = {}): TreeNode {
  return {
    id,
    type: childNodes.length > 0 || id.startsWith('c') ? 'Composite' : 'Task',
    properties: {},
    decorators: [],
    services: [],
    childNodes,
    extra: {},
    ...extra,
  };
}

const isComposite = (n: TreeNode): boolean => n.type === 'Composite';

/**
 * root (composite)
 *   c1 (composite): a, b
 *   c2 (composite): c3 (composite): d
 *   t (task)
 */
function sample(): TreeNode {
  return node('root', [
    node('c1', [node('a'), node('b')]),
    node('c2', [node('c3', [node('d')])]),
    node('t'),
  ]);
}

function ids(root: TreeNode, id: string): string[] {
  return findNode(root, id)!.childNodes.map((child) => child.id);
}

describe('resolveNodeDrop', () => {
  it('drops before / after a sibling', () => {
    const root = sample();
    expect(resolveNodeDrop(root, 'a', 't', 'before', isComposite)).toEqual({
      parentId: 'root',
      index: 2,
    });
    expect(resolveNodeDrop(root, 'a', 't', 'after', isComposite)).toEqual({
      parentId: 'root',
      index: 3,
    });
  });

  it('drops inside a composite as the last child', () => {
    expect(resolveNodeDrop(sample(), 't', 'c1', 'inside', isComposite)).toEqual({
      parentId: 'c1',
      index: 2,
    });
  });

  it('rejects non-composite parents, the root, self and descendants', () => {
    const root = sample();
    expect(resolveNodeDrop(root, 'a', 't', 'inside', isComposite)).toBeUndefined();
    expect(resolveNodeDrop(root, 'root', 'c1', 'inside', isComposite)).toBeUndefined();
    expect(resolveNodeDrop(root, 'a', 'root', 'before', isComposite)).toBeUndefined();
    expect(resolveNodeDrop(root, 'c2', 'c2', 'inside', isComposite)).toBeUndefined();
    expect(resolveNodeDrop(root, 'c2', 'c3', 'inside', isComposite)).toBeUndefined();
    expect(resolveNodeDrop(root, 'c2', 'd', 'after', isComposite)).toBeUndefined();
    expect(resolveNodeDrop(root, 'missing', 'c1', 'inside', isComposite)).toBeUndefined();
  });

  it('allows dropping into the root', () => {
    expect(resolveNodeDrop(sample(), 'd', 'root', 'inside', isComposite)).toEqual({
      parentId: 'root',
      index: 3,
    });
  });
});

describe('isSameOrDescendant', () => {
  it('checks the ancestor chain', () => {
    const root = sample();
    expect(isSameOrDescendant(root, 'c2', 'd')).toBe(true);
    expect(isSameOrDescendant(root, 'c2', 'c2')).toBe(true);
    expect(isSameOrDescendant(root, 'c1', 'd')).toBe(false);
  });
});

describe('moveNodeTo', () => {
  it('moves a subtree to another parent', () => {
    const root = sample();
    expect(moveNodeTo(root, 'c3', { parentId: 'c1', index: 1 })).toBe(true);
    expect(ids(root, 'c1')).toEqual(['a', 'c3', 'b']);
    expect(ids(root, 'c2')).toEqual([]);
    expect(ids(root, 'c3')).toEqual(['d']);
  });

  it('adjusts the index when moving forward within the same parent', () => {
    const root = sample();
    // Drop c1 after t (index 3 before removal) -> last.
    expect(moveNodeTo(root, 'c1', { parentId: 'root', index: 3 })).toBe(true);
    expect(ids(root, 'root')).toEqual(['c2', 't', 'c1']);
    // Drop c1 before c2 (index 0) -> first.
    expect(moveNodeTo(root, 'c1', { parentId: 'root', index: 0 })).toBe(true);
    expect(ids(root, 'root')).toEqual(['c1', 'c2', 't']);
  });

  it('refuses invalid moves without changing the tree', () => {
    const root = sample();
    const before = JSON.stringify(root);
    expect(moveNodeTo(root, 'root', { parentId: 'c1', index: 0 })).toBe(false);
    expect(moveNodeTo(root, 'c2', { parentId: 'c3', index: 0 })).toBe(false);
    expect(moveNodeTo(root, 'a', { parentId: 'c1', index: 5 })).toBe(false);
    expect(JSON.stringify(root)).toBe(before);
  });

  it('detects no-op drops', () => {
    const root = sample();
    expect(isNoopNodeDrop(root, 'c2', { parentId: 'root', index: 1 })).toBe(true);
    expect(isNoopNodeDrop(root, 'c2', { parentId: 'root', index: 2 })).toBe(true);
    expect(isNoopNodeDrop(root, 'c2', { parentId: 'root', index: 0 })).toBe(false);
    expect(isNoopNodeDrop(root, 'c2', { parentId: 'c1', index: 0 })).toBe(false);
  });
});

describe('sub item moves', () => {
  function withItems(): TreeNode {
    return node('root', [
      node('x', [], { decorators: [sub('d1'), sub('d2'), sub('d3')], services: [sub('s1')] }),
      node('y', [], { decorators: [sub('d4')] }),
    ]);
  }

  it('reorders within a node', () => {
    const root = withItems();
    const drop = resolveSubItemDrop(root, 'decorator', 'x', 'd3', 'after');
    expect(drop).toEqual({ nodeId: 'x', index: 3 });
    expect(moveSubItemTo(root, 'decorator', 'x', 'd1', drop!)).toBe(true);
    expect(findNode(root, 'x')!.decorators.map((d) => d.id)).toEqual(['d2', 'd3', 'd1']);
  });

  it('moves to another node, appending without a target item', () => {
    const root = withItems();
    const drop = resolveSubItemDrop(root, 'decorator', 'y', undefined, 'after');
    expect(drop).toEqual({ nodeId: 'y', index: 1 });
    expect(moveSubItemTo(root, 'decorator', 'x', 'd2', drop!)).toBe(true);
    expect(findNode(root, 'x')!.decorators.map((d) => d.id)).toEqual(['d1', 'd3']);
    expect(findNode(root, 'y')!.decorators.map((d) => d.id)).toEqual(['d4', 'd2']);
  });

  it('inserts before a target item of another node', () => {
    const root = withItems();
    const drop = resolveSubItemDrop(root, 'decorator', 'y', 'd4', 'before')!;
    moveSubItemTo(root, 'decorator', 'x', 'd1', drop);
    expect(findNode(root, 'y')!.decorators.map((d) => d.id)).toEqual(['d1', 'd4']);
  });

  it('rejects unknown targets and detects no-ops', () => {
    const root = withItems();
    expect(resolveSubItemDrop(root, 'decorator', 'x', 's1', 'before')).toBeUndefined();
    expect(resolveSubItemDrop(root, 'decorator', 'zz', undefined, 'before')).toBeUndefined();
    expect(isNoopSubItemDrop(root, 'decorator', 'x', 'd2', { nodeId: 'x', index: 2 })).toBe(true);
    expect(isNoopSubItemDrop(root, 'decorator', 'x', 'd2', { nodeId: 'x', index: 0 })).toBe(false);
    expect(moveSubItemTo(root, 'service', 'x', 'missing', { nodeId: 'y', index: 0 })).toBe(false);
  });
});
