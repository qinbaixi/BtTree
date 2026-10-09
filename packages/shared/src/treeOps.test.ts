import { describe, expect, it } from 'vitest';
import {
  addChildNode,
  addSubItem,
  findNode,
  findNodePath,
  findParent,
  findSubItem,
  forEachNode,
  getSubItems,
  itemAbove,
  moveNode,
  moveSubItem,
  removeNode,
  removeSubItem,
  setBaseProperty,
  setNodeType,
  setPropertyValue,
} from './treeOps';
import type { CompiledItemType, SubItem, TreeNode } from './types';

function sub(id: string, type = 's', properties: Record<string, unknown> = {}): SubItem {
  return { id, type, properties, extra: {} };
}

function node(
  id: string,
  opts: {
    type?: string;
    decorators?: SubItem[];
    services?: SubItem[];
    childNodes?: TreeNode[];
    properties?: Record<string, unknown>;
  } = {},
): TreeNode {
  return {
    id,
    type: opts.type ?? 'T',
    properties: opts.properties ?? {},
    decorators: opts.decorators ?? [],
    services: opts.services ?? [],
    childNodes: opts.childNodes ?? [],
    extra: {},
  };
}

/**
 * root
 *  +- a (decorators d1,d2 ; services s1,s2)
 *  |   +- a1
 *  |   +- a2 (decorators x1)
 *  +- b
 *  +- c
 */
function buildTree(): TreeNode {
  return node('root', {
    childNodes: [
      node('a', {
        decorators: [sub('d1', 'decorator'), sub('d2', 'decorator')],
        services: [sub('s1', 'service'), sub('s2', 'service')],
        childNodes: [node('a1'), node('a2', { decorators: [sub('x1', 'decorator')] })],
      }),
      node('b'),
      node('c'),
    ],
  });
}

const compiledDummy = (properties: CompiledItemType['properties']): CompiledItemType => ({
  kind: 'node',
  name: 'Dummy',
  color: '#000',
  isComposite: false,
  properties,
});

describe('forEachNode', () => {
  it('visits nodes in pre-order', () => {
    const ids: string[] = [];
    forEachNode(buildTree(), (n) => ids.push(n.id));
    expect(ids).toEqual(['root', 'a', 'a1', 'a2', 'b', 'c']);
  });
});

describe('findNode / findParent / findNodePath', () => {
  it('finds the root and deep nodes', () => {
    const root = buildTree();
    expect(findNode(root, 'root')).toBe(root);
    expect(findNode(root, 'a2')?.id).toBe('a2');
  });

  it('returns undefined for unknown ids', () => {
    expect(findNode(buildTree(), 'nope')).toBeUndefined();
  });

  it('finds parents; root and unknown ids have none', () => {
    const root = buildTree();
    expect(findParent(root, 'a2')?.id).toBe('a');
    expect(findParent(root, 'a')?.id).toBe('root');
    expect(findParent(root, 'root')).toBeUndefined();
    expect(findParent(root, 'zzz')).toBeUndefined();
  });

  it('returns the path from root to the node', () => {
    expect(findNodePath(buildTree(), 'a2').map((n) => n.id)).toEqual(['root', 'a', 'a2']);
    expect(findNodePath(buildTree(), 'root').map((n) => n.id)).toEqual(['root']);
    expect(findNodePath(buildTree(), 'zzz')).toEqual([]);
  });
});

describe('sub item lookup', () => {
  it('getSubItems returns decorators or services', () => {
    const a = findNode(buildTree(), 'a')!;
    expect(getSubItems(a, 'decorator').map((i) => i.id)).toEqual(['d1', 'd2']);
    expect(getSubItems(a, 'service').map((i) => i.id)).toEqual(['s1', 's2']);
  });

  it('findSubItem finds by kind and id only', () => {
    const a = findNode(buildTree(), 'a')!;
    expect(findSubItem(a, 'service', 's2')?.id).toBe('s2');
    expect(findSubItem(a, 'service', 'd1')).toBeUndefined();
    expect(findSubItem(a, 'decorator', 'zz')).toBeUndefined();
  });
});

describe('addChildNode / removeNode / moveNode', () => {
  it('addChildNode appends by default and inserts at index', () => {
    const parent = node('p', { childNodes: [node('n1'), node('n2')] });
    addChildNode(parent, node('end'));
    addChildNode(parent, node('mid'), 1);
    expect(parent.childNodes.map((n) => n.id)).toEqual(['n1', 'mid', 'n2', 'end']);
  });

  it('removeNode removes the whole subtree and reports parent and index', () => {
    const root = buildTree();
    const res = removeNode(root, 'a');
    expect(res).toEqual({ parentId: 'root', index: 0 });
    expect(findNode(root, 'a')).toBeUndefined();
    expect(findNode(root, 'a1')).toBeUndefined();
    expect(root.childNodes.map((n) => n.id)).toEqual(['b', 'c']);
  });

  it('removeNode returns undefined for unknown ids', () => {
    expect(removeNode(buildTree(), 'zzz')).toBeUndefined();
  });

  it('removeNode throws when removing the root', () => {
    expect(() => removeNode(buildTree(), 'root')).toThrow(/Root node cannot be removed/);
  });

  it('moveNode swaps with the sibling up and down', () => {
    const root = buildTree();
    expect(moveNode(root, 'b', 1)).toBe(true);
    expect(root.childNodes.map((n) => n.id)).toEqual(['a', 'c', 'b']);
    expect(moveNode(root, 'b', -1)).toBe(true);
    expect(root.childNodes.map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('moveNode returns false at the bounds and for the root', () => {
    const root = buildTree();
    expect(moveNode(root, 'a', -1)).toBe(false);
    expect(moveNode(root, 'c', 1)).toBe(false);
    expect(moveNode(root, 'root', 1)).toBe(false);
    expect(root.childNodes.map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('sub item mutations', () => {
  it('addSubItem appends by default and inserts at index', () => {
    const a = node('a', { services: [sub('s1'), sub('s2')] });
    addSubItem(a, 'service', sub('new'), 1);
    addSubItem(a, 'service', sub('end'));
    expect(a.services.map((s) => s.id)).toEqual(['s1', 'new', 's2', 'end']);
  });

  it('removeSubItem returns the former index, or -1 when not found', () => {
    const a = node('a', { decorators: [sub('d1', 'decorator'), sub('d2', 'decorator')] });
    expect(removeSubItem(a, 'decorator', 'd2')).toBe(1);
    expect(a.decorators.map((d) => d.id)).toEqual(['d1']);
    expect(removeSubItem(a, 'decorator', 'd2')).toBe(-1);
  });

  it('moveSubItem moves a service up and down', () => {
    const a = findNode(buildTree(), 'a')!;
    expect(moveSubItem(a, 'service', 's2', -1)).toBe(true);
    expect(a.services.map((s) => s.id)).toEqual(['s2', 's1']);
    expect(moveSubItem(a, 'service', 's2', 1)).toBe(true);
    expect(a.services.map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('moveSubItem moves a decorator up and down', () => {
    const a = findNode(buildTree(), 'a')!;
    expect(moveSubItem(a, 'decorator', 'd1', 1)).toBe(true);
    expect(a.decorators.map((d) => d.id)).toEqual(['d2', 'd1']);
  });

  it('moveSubItem returns false at bounds or when the item is missing', () => {
    const a = findNode(buildTree(), 'a')!;
    expect(moveSubItem(a, 'service', 's1', -1)).toBe(false);
    expect(moveSubItem(a, 'service', 's2', 1)).toBe(false);
    expect(moveSubItem(a, 'decorator', 'missing', 1)).toBe(false);
    expect(a.services.map((s) => s.id)).toEqual(['s1', 's2']);
  });
});

describe('property setters', () => {
  it('setPropertyValue sets a value and keeps others', () => {
    const item = { properties: { a: 1, b: 2 } as Record<string, unknown> };
    setPropertyValue(item, 'a', 10);
    expect(item.properties).toEqual({ a: 10, b: 2 });
    setPropertyValue(item, 'c', 'new');
    expect(item.properties['c']).toBe('new');
  });

  it('setPropertyValue deletes the key for null and undefined', () => {
    const item = { properties: { a: 1, b: 2 } as Record<string, unknown> };
    setPropertyValue(item, 'a', null);
    setPropertyValue(item, 'b', undefined);
    expect(item.properties).toEqual({});
    expect('a' in item.properties).toBe(false);
  });

  it('setBaseProperty sets and deletes base fields', () => {
    const item: SubItem = sub('x');
    setBaseProperty(item, 'label', 'L');
    setBaseProperty(item, 'periodic', true);
    setBaseProperty(item, 'timeBetweenTicks', 0.5);
    expect(item.label).toBe('L');
    expect(item.periodic).toBe(true);
    expect(item.timeBetweenTicks).toBe(0.5);

    setBaseProperty(item, 'label', null);
    setBaseProperty(item, 'periodic', undefined);
    expect('label' in item).toBe(false);
    expect('periodic' in item).toBe(false);
  });
});

describe('setNodeType', () => {
  it('sets the type and removes properties not declared by the new type', () => {
    const n = node('n', { type: 'Old', properties: { keep: 1, drop: 'x', other: true } });
    const removed = setNodeType(n, 'New', compiledDummy([{ name: 'keep', type: 'number' }]));
    expect(n.type).toBe('New');
    expect(n.properties).toEqual({ keep: 1 });
    expect(removed).toEqual({ drop: 'x', other: true });
  });

  it('returns an empty map when nothing is removed', () => {
    const n = node('n', { properties: { a: 1 } });
    expect(setNodeType(n, 'T2', compiledDummy([{ name: 'a', type: 'number' }]))).toEqual({});
    expect(n.properties).toEqual({ a: 1 });
  });
});

describe('itemAbove', () => {
  const root = buildTree();

  it('returns undefined for the root node', () => {
    expect(itemAbove(root, { kind: 'node', nodeId: 'root' })).toBeUndefined();
  });

  it('for a node header returns the last service of the parent, then last decorator, then parent', () => {
    expect(itemAbove(root, { kind: 'node', nodeId: 'b' })).toEqual({
      kind: 'node',
      nodeId: 'root',
    });
    expect(itemAbove(root, { kind: 'node', nodeId: 'a1' })).toEqual({
      kind: 'service',
      nodeId: 'a',
      itemId: 's2',
    });

    const onlyDecorators = node('r', {
      childNodes: [node('p', { decorators: [sub('d', 'decorator')], childNodes: [node('k')] })],
    });
    expect(itemAbove(onlyDecorators, { kind: 'node', nodeId: 'k' })).toEqual({
      kind: 'decorator',
      nodeId: 'p',
      itemId: 'd',
    });

    const bare = node('r', { childNodes: [node('p', { childNodes: [node('k')] })] });
    expect(itemAbove(bare, { kind: 'node', nodeId: 'k' })).toEqual({ kind: 'node', nodeId: 'p' });
  });

  it('for a sub item returns the previous item of the same kind', () => {
    expect(itemAbove(root, { kind: 'service', nodeId: 'a', itemId: 's2' })).toEqual({
      kind: 'service',
      nodeId: 'a',
      itemId: 's1',
    });
    expect(itemAbove(root, { kind: 'decorator', nodeId: 'a', itemId: 'd2' })).toEqual({
      kind: 'decorator',
      nodeId: 'a',
      itemId: 'd1',
    });
  });

  it('for the first decorator returns the node header', () => {
    expect(itemAbove(root, { kind: 'decorator', nodeId: 'a', itemId: 'd1' })).toEqual({
      kind: 'node',
      nodeId: 'a',
    });
  });

  it('for the first service returns the last decorator when decorators exist, else the node header', () => {
    expect(itemAbove(root, { kind: 'service', nodeId: 'a', itemId: 's1' })).toEqual({
      kind: 'decorator',
      nodeId: 'a',
      itemId: 'd2',
    });
    expect(itemAbove(root, { kind: 'service', nodeId: 'a1', itemId: 'missing' })).toBeUndefined();

    const svcOnly = node('r', { childNodes: [node('p', { services: [sub('v1')] })] });
    expect(itemAbove(svcOnly, { kind: 'service', nodeId: 'p', itemId: 'v1' })).toEqual({
      kind: 'node',
      nodeId: 'p',
    });
  });

  it('returns undefined for unknown nodes or items', () => {
    expect(itemAbove(root, { kind: 'node', nodeId: 'nope' })).toBeUndefined();
    expect(itemAbove(root, { kind: 'decorator', nodeId: 'nope', itemId: 'd1' })).toBeUndefined();
    expect(itemAbove(root, { kind: 'decorator', nodeId: 'a', itemId: 'nope' })).toBeUndefined();
  });
});
