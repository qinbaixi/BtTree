import { hierarchy, tree } from 'd3-hierarchy';
import type { TreeNode } from '@owlbt/shared';

/** Layout constants, ported from the original treeView directive. */
export const BASE_WIDTH = 150;
export const BASE_HEIGHT = 40;
export const SEPARATION_X = 50;
export const SEPARATION_Y = 70;
export const LINK_START_HEIGHT = 10;
export const MARGIN = 50;
export const MIN_CANVAS_SIZE = 500;

export interface Size {
  width: number;
  height: number;
}

export interface NodeLayout {
  /** Left edge in canvas coordinates. */
  x: number;
  /** Top edge in canvas coordinates. */
  y: number;
  width: number;
  height: number;
  depth: number;
}

export interface LinkLayout {
  parentId: string;
  childId: string;
  /** Start point (bottom of the parent, below the link stub). */
  sx: number;
  sy: number;
  /** End point (top center of the child). */
  tx: number;
  ty: number;
}

export interface LinkStartLayout {
  x: number;
  y1: number;
  y2: number;
}

export interface TreeLayout {
  nodes: Map<string, NodeLayout>;
  links: LinkLayout[];
  linkStarts: LinkStartLayout[];
  width: number;
  height: number;
}

export type SizeMap = ReadonlyMap<string, Size>;

function finiteOrZero(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** Vertical bezier from source to target (same shape as d3.svg.diagonal). */
export function linkPath(link: Pick<LinkLayout, 'sx' | 'sy' | 'tx' | 'ty'>): string {
  const mid = (link.sy + link.ty) / 2;
  return `M${link.sx},${link.sy}C${link.sx},${mid} ${link.tx},${mid} ${link.tx},${link.ty}`;
}

/**
 * Computes node positions. Sizes are measured DOM sizes keyed by node id; unknown sizes count as 0.
 * Horizontal positions come from d3-hierarchy's tree with a width-dependent separation;
 * vertical positions are per depth level (level height = tallest node of the level + separation).
 * Nodes in `collapsed` are laid out as leaves: their descendants are missing from the result.
 */
export function computeTreeLayout(
  root: TreeNode,
  sizes: SizeMap,
  collapsed?: ReadonlySet<string>,
): TreeLayout {
  // Separation runs for every pair of neighbours, so widths are looked up without allocating.
  const widthOf = (id: string): number => finiteOrZero(sizes.get(id)?.width);
  const heightOf = (id: string): number => finiteOrZero(sizes.get(id)?.height);

  // Descendants of collapsed nodes are left out of the layout (not positioned, no links).
  const hierarchyRoot = hierarchy<TreeNode>(root, (node) =>
    collapsed?.has(node.id) ? undefined : node.childNodes,
  );
  const positioned = tree<TreeNode>()
    .nodeSize([BASE_WIDTH, BASE_HEIGHT])
    .separation(
      (a, b) => ((widthOf(a.data.id) + widthOf(b.data.id) + SEPARATION_X) / BASE_WIDTH) * 0.5,
    )(hierarchyRoot);

  const all = positioned.descendants();

  const maxHeightPerDepth: number[] = [];
  for (const item of all) {
    const height = heightOf(item.data.id);
    maxHeightPerDepth[item.depth] = Math.max(maxHeightPerDepth[item.depth] ?? 0, height);
  }
  const levelTop: number[] = [];
  let currentTop = 0;
  for (let depth = 0; depth < maxHeightPerDepth.length; depth++) {
    levelTop.push(currentTop);
    currentTop += maxHeightPerDepth[depth] + SEPARATION_Y;
  }

  let minLeft = Infinity;
  let maxRight = -Infinity;
  let maxBottom = -Infinity;
  const raw = all.map((item) => {
    const width = widthOf(item.data.id);
    const height = heightOf(item.data.id);
    const left = item.x - width / 2;
    const top = levelTop[item.depth];
    minLeft = Math.min(minLeft, left);
    maxRight = Math.max(maxRight, left + width);
    maxBottom = Math.max(maxBottom, top + height);
    return { id: item.data.id, left, top, width, height, depth: item.depth };
  });
  if (!Number.isFinite(minLeft)) {
    minLeft = 0;
    maxRight = 0;
    maxBottom = 0;
  }

  const nodes = new Map<string, NodeLayout>();
  for (const item of raw) {
    nodes.set(item.id, {
      x: item.left - minLeft + MARGIN,
      y: item.top + MARGIN,
      width: item.width,
      height: item.height,
      depth: item.depth,
    });
  }

  const links: LinkLayout[] = [];
  const linkStarts: LinkStartLayout[] = [];
  for (const parent of all) {
    if (parent.children === undefined || parent.children.length === 0) {
      continue;
    }
    const p = nodes.get(parent.data.id);
    if (!p) {
      continue;
    }
    const centerX = p.x + p.width / 2;
    const bottom = p.y + p.height;
    linkStarts.push({ x: centerX, y1: bottom, y2: bottom + LINK_START_HEIGHT });
    for (const child of parent.children) {
      const c = nodes.get(child.data.id);
      if (!c) {
        continue;
      }
      links.push({
        parentId: parent.data.id,
        childId: child.data.id,
        sx: centerX,
        sy: bottom + LINK_START_HEIGHT,
        tx: c.x + c.width / 2,
        ty: c.y,
      });
    }
  }

  return {
    nodes,
    links,
    linkStarts,
    width: Math.max(maxRight - minLeft + MARGIN * 2, MIN_CANVAS_SIZE),
    height: Math.max(maxBottom + MARGIN * 2, MIN_CANVAS_SIZE),
  };
}
