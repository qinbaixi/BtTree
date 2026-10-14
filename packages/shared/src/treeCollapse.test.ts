import { describe, expect, it } from 'vitest';
import {
  collapsedToPaths,
  collapsibleIds,
  countDescendants,
  hiddenBy,
  isCollapsedNode,
  pathsToCollapsed,
} from './treeCollapse';
import type { TreeNode } from './types';

function node(id: string, childNodes: TreeNode[] = []): TreeNode {
  return { id, type: 'T', properties: {}, decorators: [], services: [], childNodes, extra: {} };
}

/** root: [a: [a1, a2: [x]], b] */
function sample(): TreeNode {
  return node('root', [node('a', [node('a1'), node('a2', [node('x')])]), node('b')]);
}

describe('treeCollapse', () => {
  it('counts descendants', () => {
    const root = sample();
    expect(countDescendants(root)).toBe(5);
    expect(countDescendants(root.childNodes[0])).toBe(3);
    expect(countDescendants(root.childNodes[1])).toBe(0);
  });

  it('ignores leaves in the collapsed set', () => {
    const root = sample();
    expect(isCollapsedNode(root.childNodes[1], new Set(['b']))).toBe(false);
    expect(isCollapsedNode(root.childNodes[0], new Set(['a']))).toBe(true);
  });

  it('lists collapsed ancestors hiding a node', () => {
    const root = sample();
    expect(hiddenBy(root, 'x', new Set(['a', 'a2']))).toEqual(['a', 'a2']);
    expect(hiddenBy(root, 'a2', new Set(['a2']))).toEqual([]);
    expect(hiddenBy(root, 'b', new Set(['a']))).toEqual([]);
    expect(hiddenBy(root, 'missing', new Set(['a']))).toEqual([]);
  });

  it('lists collapsible nodes', () => {
    expect(collapsibleIds(sample())).toEqual(['root', 'a', 'a2']);
  });

  it('round-trips collapsed ids through index paths', () => {
    const root = sample();
    const paths = collapsedToPaths(root, new Set(['root', 'a2', 'b', 'unknown']));
    expect(paths).toEqual(['', '0.1']);
    expect([...pathsToCollapsed(root, paths)]).toEqual(['root', 'a2']);
  });

  it('skips invalid persisted paths', () => {
    const root = sample();
    expect([...pathsToCollapsed(root, ['5', '0.x', '1', 3, null, '0'])]).toEqual(['a']);
  });
});
