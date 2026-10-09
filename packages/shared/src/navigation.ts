import type { NavDirection, Selection, TreeNode } from './types';
import { findNode, findParent, getSubItems, itemAbove } from './treeOps';

function rootSelection(root: TreeNode): Selection {
  return { kind: 'node', nodeId: root.id };
}

/** Middle child, as used by the original editor when moving down out of a node's items. */
function middleChildSelection(node: TreeNode): Selection | undefined {
  const count = node.childNodes.length;
  if (count === 0) {
    return undefined;
  }
  const middle = node.childNodes[Math.floor((count - 1) / 2)];
  return { kind: 'node', nodeId: middle.id };
}

/** Visual order below the selection: node -> decorators -> services -> middle child. */
function itemBelow(root: TreeNode, sel: Selection): Selection | undefined {
  const node = findNode(root, sel.nodeId);
  if (!node) {
    return undefined;
  }

  if (sel.kind === 'node') {
    if (node.decorators.length > 0) {
      return { kind: 'decorator', nodeId: node.id, itemId: node.decorators[0].id };
    }
    if (node.services.length > 0) {
      return { kind: 'service', nodeId: node.id, itemId: node.services[0].id };
    }
    return middleChildSelection(node);
  }

  const items = getSubItems(node, sel.kind);
  const index = items.findIndex((item) => item.id === sel.itemId);
  if (index < 0) {
    return undefined;
  }
  if (index < items.length - 1) {
    return { kind: sel.kind, nodeId: node.id, itemId: items[index + 1].id };
  }
  if (sel.kind === 'decorator' && node.services.length > 0) {
    return { kind: 'service', nodeId: node.id, itemId: node.services[0].id };
  }
  return middleChildSelection(node);
}

/** Node header of the sibling node (left/right); a sub item uses its owning node. */
function siblingSelection(root: TreeNode, sel: Selection, left: boolean): Selection | undefined {
  const parent = findParent(root, sel.nodeId);
  if (!parent) {
    return undefined;
  }
  const index = parent.childNodes.findIndex((child) => child.id === sel.nodeId);
  const siblingIndex = left ? index - 1 : index + 1;
  if (index < 0 || siblingIndex < 0 || siblingIndex >= parent.childNodes.length) {
    return undefined;
  }
  return { kind: 'node', nodeId: parent.childNodes[siblingIndex].id };
}

/**
 * Computes the selection after moving in a direction. Returns the same selection when there is no target.
 * With no selection, the root node is selected.
 */
export function navigate(root: TreeNode, sel: Selection | undefined, dir: NavDirection): Selection {
  if (!sel) {
    return rootSelection(root);
  }
  switch (dir) {
    case 'down':
      return itemBelow(root, sel) ?? sel;
    case 'up':
      return itemAbove(root, sel) ?? sel;
    case 'left':
      return siblingSelection(root, sel, true) ?? sel;
    case 'right':
      return siblingSelection(root, sel, false) ?? sel;
  }
}
