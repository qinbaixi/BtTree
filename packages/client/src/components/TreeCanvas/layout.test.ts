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
