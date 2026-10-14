import { createIdGen, nodeFromJson, type TreeNode } from '@owlbt/shared';
import { describe, expect, it } from 'vitest';
import { TREE_JSON } from '../../test/fixtures';
import { computeTreeLayout, linkPath, MARGIN, MIN_CANVAS_SIZE, SEPARATION_Y } from './layout';

function buildTree(): TreeNode {
  return nodeFromJson(structuredClone(TREE_JSON), createIdGen('l'));
}

describe('computeTreeLayout', () => {
  it('positions every node and never produces NaN without measured sizes', () => {
    const root = buildTree();
    const layout = computeTreeLayout(root, new Map());

    expect(layout.nodes.size).toBe(3);
    for (const node of layout.nodes.values()) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
    expect(layout.width).toBeGreaterThanOrEqual(MIN_CANVAS_SIZE);
    expect(layout.height).toBeGreaterThanOrEqual(MIN_CANVAS_SIZE);
  });

  it('puts children one level below the parent with a margin on the top', () => {
    const root = buildTree();
    const sizes = new Map(
      [root, ...root.childNodes].map((n) => [n.id, { width: 150, height: 60 }] as const),
    );
    const layout = computeTreeLayout(root, sizes);

    const rootPos = layout.nodes.get(root.id)!;
    const childPos = layout.nodes.get(root.childNodes[0].id)!;
    expect(rootPos.y).toBe(MARGIN);
    expect(childPos.y).toBe(MARGIN + 60 + SEPARATION_Y);
  });

  it('creates one link per parent-child pair and a link stub per parent', () => {
    const root = buildTree();
    const layout = computeTreeLayout(root, new Map());
    expect(layout.links).toHaveLength(2);
    expect(layout.linkStarts).toHaveLength(1);
    expect(layout.links[0].parentId).toBe(root.id);
  });

  it('separates siblings by their measured widths', () => {
    const root = buildTree();
    const [a, b] = root.childNodes;
    const narrow = computeTreeLayout(
      root,
      new Map([
        [a.id, { width: 100, height: 40 }],
        [b.id, { width: 100, height: 40 }],
      ]),
    );
    const wide = computeTreeLayout(
      root,
      new Map([
        [a.id, { width: 400, height: 40 }],
        [b.id, { width: 400, height: 40 }],
      ]),
    );
    const gap = (l: typeof narrow) => l.nodes.get(b.id)!.x - l.nodes.get(a.id)!.x;
    expect(gap(wide)).toBeGreaterThan(gap(narrow));
  });

  it('builds a vertical bezier path between link ends', () => {
    expect(linkPath({ sx: 10, sy: 20, tx: 30, ty: 60 })).toBe('M10,20C10,40 30,40 30,60');
  });
});

describe('computeTreeLayout with collapsed nodes', () => {
  function deepTree(): TreeNode {
    return nodeFromJson(
      {
        type: 'Root',
        childNodes: [
          { type: 'A', childNodes: [{ type: 'A1' }, { type: 'A2', childNodes: [{ type: 'X' }] }] },
          { type: 'B' },
        ],
      },
      createIdGen('c'),
    );
  }

  it('leaves out the descendants of a collapsed node', () => {
    const root = deepTree();
    const a = root.childNodes[0];
    const layout = computeTreeLayout(root, new Map(), new Set([a.id]));

    expect([...layout.nodes.keys()]).toEqual([root.id, a.id, root.childNodes[1].id]);
    expect(layout.links.map((link) => link.childId)).toEqual(root.childNodes.map((n) => n.id));
    // Only the root still has visible children.
    expect(layout.linkStarts).toHaveLength(1);
  });

  it('collapsing the root shows only the root', () => {
    const root = deepTree();
    const layout = computeTreeLayout(root, new Map(), new Set([root.id]));
    expect([...layout.nodes.keys()]).toEqual([root.id]);
    expect(layout.links).toHaveLength(0);
    expect(layout.linkStarts).toHaveLength(0);
  });

  it('ignores collapsed ids that are not visible or unknown', () => {
    const root = deepTree();
    const full = computeTreeLayout(root, new Map());
    const same = computeTreeLayout(root, new Map(), new Set(['unknown', root.childNodes[1].id]));
    expect(same.nodes.size).toBe(full.nodes.size);
  });
});
