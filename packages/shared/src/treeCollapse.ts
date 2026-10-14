import type { TreeNode } from './types';
import { findNodePath, forEachNode } from './treeOps';

/** Number of descendants of a node (children, grandchildren, ...), excluding the node itself. */
export function countDescendants(node: TreeNode): number {
  let count = 0;
  for (const child of node.childNodes) {
    count += 1 + countDescendants(child);
  }
  return count;
}

/** True when the node has children and is in the collapsed set (a leaf never counts as collapsed). */
export function isCollapsedNode(node: TreeNode, collapsed: ReadonlySet<string>): boolean {
  return node.childNodes.length > 0 && collapsed.has(node.id);
}

/**
 * Collapsed ancestors that hide the node (outermost first). Empty when the node is visible or
 * unknown. Expanding all of them reveals the node.
 */
export function hiddenBy(root: TreeNode, nodeId: string, collapsed: ReadonlySet<string>): string[] {
  const path = findNodePath(root, nodeId);
  return path
    .slice(0, -1)
    .filter((node) => collapsed.has(node.id))
    .map((node) => node.id);
}

/** Ids of the nodes that have children (the ones that can be collapsed). */
export function collapsibleIds(root: TreeNode): string[] {
  const ids: string[] = [];
  forEachNode(root, (node) => {
    if (node.childNodes.length > 0) {
      ids.push(node.id);
    }
  });
  return ids;
}

/**
 * Converts collapsed node ids to stable child index paths ('' = root, '0.2' = third child of the
 * first child). Runtime ids change on every load, so persisted state uses these paths.
 */
export function collapsedToPaths(root: TreeNode, collapsed: ReadonlySet<string>): string[] {
  const paths: string[] = [];
  const visit = (node: TreeNode, path: string): void => {
    if (isCollapsedNode(node, collapsed)) {
      paths.push(path);
    }
    node.childNodes.forEach((child, index) => {
      visit(child, path === '' ? String(index) : `${path}.${index}`);
    });
  };
  visit(root, '');
  return paths;
}

/** Resolves child index paths (see collapsedToPaths) to node ids. Unknown paths are skipped. */
export function pathsToCollapsed(root: TreeNode, paths: readonly unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const path of paths) {
    if (typeof path !== 'string') {
      continue;
    }
    let node: TreeNode | undefined = root;
    if (path !== '') {
      for (const part of path.split('.')) {
        const index = /^\d+$/.test(part) ? Number(part) : -1;
        node = node?.childNodes[index];
      }
    }
    if (node && node.childNodes.length > 0) {
      ids.add(node.id);
    }
  }
  return ids;
}
