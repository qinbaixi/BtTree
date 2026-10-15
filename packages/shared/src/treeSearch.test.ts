import { describe, expect, it } from 'vitest';
import { itemMatches, searchTree, selectionKey } from './treeSearch';
import type { SubItem, TreeNode } from './types';

function sub(id: string, type: string, extra: Partial<SubItem> = {}): SubItem {
  return { id, type, properties: {}, extra: {}, ...extra };
}

function node(id: string, type: string, extra: Partial<TreeNode> = {}): TreeNode {
  return {
    id,
    type,
    properties: {},
    decorators: [],
    services: [],
    childNodes: [],
    extra: {},
    ...extra,
  };
}

function sample(): TreeNode {
  return node('root', 'Selector', {
    childNodes: [
      node('n1', 'Sequence', {
        label: 'Attack enemy',
        decorators: [sub('d1', 'Blackboard', { properties: { Key: 'HasTarget' } })],
        services: [sub('s1', 'UpdateTarget', { label: 'find enemy' })],
        childNodes: [node('n2', 'MoveTo', { properties: { Speed: 300, Run: true } })],
      }),
      node('n3', 'Wait', { comment: 'idle when no ENEMY' }),
    ],
  });
}

describe('treeSearch', () => {
  it('matches type, label, comment and property values case-insensitively', () => {
    const root = sample();
    expect(searchTree(root, 'selector')).toEqual([{ kind: 'node', nodeId: 'root' }]);
    expect(searchTree(root, '300')).toEqual([{ kind: 'node', nodeId: 'n2' }]);
    expect(searchTree(root, 'TRUE')).toEqual([{ kind: 'node', nodeId: 'n2' }]);
    expect(searchTree(root, 'hastarget')).toEqual([
      { kind: 'decorator', nodeId: 'n1', itemId: 'd1' },
    ]);
  });

  it('returns results in visual order (node, decorators, services, children)', () => {
    expect(searchTree(sample(), 'enemy')).toEqual([
      { kind: 'node', nodeId: 'n1' },
      { kind: 'service', nodeId: 'n1', itemId: 's1' },
      { kind: 'node', nodeId: 'n3' },
    ]);
    expect(searchTree(sample(), 'target').map(selectionKey)).toEqual(['d1', 's1']);
  });

  it('matches nothing for an empty or blank query', () => {
    expect(searchTree(sample(), '')).toEqual([]);
    expect(searchTree(sample(), '   ')).toEqual([]);
    expect(itemMatches(sample(), ' ')).toBe(false);
  });

  it('trims the query and searches object values as JSON', () => {
    const item = node('x', 'T', { properties: { Data: { a: 'deep' } } });
    expect(itemMatches(item, '  deep ')).toBe(true);
    expect(itemMatches(item, 'shallow')).toBe(false);
  });
});
