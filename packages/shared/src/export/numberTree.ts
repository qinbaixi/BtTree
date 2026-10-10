import type { ItemKind, SubItem, TreeNode } from '../types';

/** One numbered item of the tree: a node, a decorator or a service. */
export interface NumberedItem {
  id: number;
  kind: ItemKind;
  item: TreeNode | SubItem;
  /** The node a decorator or service belongs to. Undefined for nodes. */
  owner?: TreeNode;
  /** Location in the tree, e.g. `root.childNodes[0].decorators[1]`. Used in messages. */
  path: string;
}

/**
 * Assigns ids 1..N depth-first. For every node: its decorators, then its services, then the node itself,
 * then its children (recursively). The root is always 1 and is numbered before its own sub items.
 */
export function numberTree(root: TreeNode): NumberedItem[] {
  const out: NumberedItem[] = [];
  const visit = (node: TreeNode, path: string, isRoot = false): void => {
    if (isRoot) {
      out.push({ id: out.length + 1, kind: 'node', item: node, path });
    }
    node.decorators.forEach((decorator, index) => {
      out.push({
        id: out.length + 1,
        kind: 'decorator',
        item: decorator,
        owner: node,
        path: `${path}.decorators[${index}]`,
      });
    });
    node.services.forEach((service, index) => {
      out.push({
        id: out.length + 1,
        kind: 'service',
        item: service,
        owner: node,
        path: `${path}.services[${index}]`,
      });
    });
    if (!isRoot) {
      out.push({ id: out.length + 1, kind: 'node', item: node, path });
    }
    node.childNodes.forEach((child, index) => {
      visit(child, `${path}.childNodes[${index}]`);
    });
  };
  visit(root, 'root', true);
  return out;
}
