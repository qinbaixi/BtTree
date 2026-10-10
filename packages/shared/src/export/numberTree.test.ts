import { describe, expect, it } from 'vitest';
import { createIdGen, nodeFromJson } from '../treeModel';
import type { TreeNodeJson } from '../types';
import { numberTree } from './numberTree';

const TREE: TreeNodeJson = {
  type: 'Selector',
  childNodes: [
    { type: 'Task', decorators: [{ type: 'D' }] },
    { type: 'Task', decorators: [{ type: 'D' }] },
    {
      type: 'Selector',
      services: [{ type: 'S' }],
      childNodes: [
        { type: 'Sequence', childNodes: [{ type: 'Task' }, { type: 'Task' }] },
        { type: 'Task' },
      ],
    },
  ],
};

describe('numberTree', () => {
  const numbered = numberTree(nodeFromJson(TREE, createIdGen()));

  it('numbers depth-first with sub items before their owner', () => {
    expect(numbered.map((n) => [n.id, n.kind, n.item.type])).toEqual([
      [1, 'node', 'Selector'],
      [2, 'decorator', 'D'],
      [3, 'node', 'Task'],
      [4, 'decorator', 'D'],
      [5, 'node', 'Task'],
      [6, 'service', 'S'],
      [7, 'node', 'Selector'],
      [8, 'node', 'Sequence'],
      [9, 'node', 'Task'],
      [10, 'node', 'Task'],
      [11, 'node', 'Task'],
    ]);
  });

  it('gives the root id 1 when it has no sub items', () => {
    expect(numberTree(nodeFromJson({ type: 'Selector' }, createIdGen()))[0].id).toBe(1);
  });

  it('always gives the root id 1, numbering its own sub items right after it', () => {
    const items = numberTree(
      nodeFromJson(
        {
          type: 'Selector',
          decorators: [{ type: 'D' }],
          services: [{ type: 'S' }],
          childNodes: [{ type: 'Task', decorators: [{ type: 'D' }] }],
        },
        createIdGen(),
      ),
    );
    expect(items.map((n) => [n.id, n.kind, n.item.type])).toEqual([
      [1, 'node', 'Selector'],
      [2, 'decorator', 'D'],
      [3, 'service', 'S'],
      [4, 'decorator', 'D'],
      [5, 'node', 'Task'],
    ]);
  });

  it('records the owner of sub items and their paths', () => {
    const decorator = numbered[1];
    expect(decorator.owner).toBeDefined();
    expect(decorator.owner?.type).toBe('Task');
    expect(decorator.path).toBe('root.childNodes[0].decorators[0]');
    expect(numbered[0].owner).toBeUndefined();
    expect(numbered[9].path).toBe('root.childNodes[2].childNodes[0].childNodes[1]');
    expect(numbered[10].path).toBe('root.childNodes[2].childNodes[1]');
  });
});
