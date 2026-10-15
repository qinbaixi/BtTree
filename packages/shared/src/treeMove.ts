import type { SubItemKind, TreeNode } from './types';
import { findNode, findNodePath, findParent, getSubItems } from './treeOps';

/** Where a dragged item is dropped relative to the target: before/after it, or into it. */
export type DropPosition = 'before' | 'after' | 'inside';

/** Resolved destination of a node move: insert into `parentId` at `index` (index before removal). */
export interface NodeDropTarget {
  parentId: string;
  index: number;
}

/** True when `nodeId` is `ancestorId` or one of its descendants. */
export function isSameOrDescendant(root: TreeNode, ancestorId: string, nodeId: string): boolean {
  return findNodePath(root, nodeId).some((node) => node.id === ancestorId);
}

/**
 * Resolves dropping the node `dragId` before/after/inside the node `targetId`.
 * Returns undefined when the drop is not allowed: moving the root, dropping onto the node itself or
 * one of its descendants, dropping inside a non-composite node, or before/after the root.
 * `isComposite` tells whether a node may have children.
 */
export function resolveNodeDrop(
  root: TreeNode,
  dragId: string,
  targetId: string,
  position: DropPosition,
  isComposite: (node: TreeNode) => boolean,
): NodeDropTarget | undefined {
  if (dragId === root.id || !findNode(root, dragId)) {
    return undefined;
  }
  const target = findNode(root, targetId);
  if (!target || isSameOrDescendant(root, dragId, targetId)) {
    return undefined;
  }
  if (position === 'inside') {
    return isComposite(target)
      ? { parentId: target.id, index: target.childNodes.length }
      : undefined;
  }
  const parent = findParent(root, targetId);
  if (!parent) {
    return undefined;
  }
  const index = parent.childNodes.findIndex((child) => child.id === targetId);
  return { parentId: parent.id, index: position === 'before' ? index : index + 1 };
}

/** True when the node drop would leave the tree unchanged. */
export function isNoopNodeDrop(root: TreeNode, dragId: string, drop: NodeDropTarget): boolean {
  const parent = findParent(root, dragId);
  if (!parent || parent.id !== drop.parentId) {
    return false;
  }
  const from = parent.childNodes.findIndex((child) => child.id === dragId);
  return drop.index === from || drop.index === from + 1;
}

/**
 * Moves a node (with its subtree) to `drop`. The index refers to the parent's children before the
 * node is removed. Returns false (and changes nothing) when the move is invalid.
 */
export function moveNodeTo(root: TreeNode, dragId: string, drop: NodeDropTarget): boolean {
  if (dragId === root.id || isSameOrDescendant(root, dragId, drop.parentId)) {
    return false;
  }
  const from = findParent(root, dragId);
  const to = findNode(root, drop.parentId);
  if (!from || !to || drop.index < 0 || drop.index > to.childNodes.length) {
    return false;
  }
  const fromIndex = from.childNodes.findIndex((child) => child.id === dragId);
  const [node] = from.childNodes.splice(fromIndex, 1);
  const index = from === to && fromIndex < drop.index ? drop.index - 1 : drop.index;
  to.childNodes.splice(index, 0, node);
  return true;
}

/** Resolved destination of a decorator/service move (index before removal). */
export interface SubItemDropTarget {
  nodeId: string;
  index: number;
}

/**
 * Resolves dropping a decorator/service. `targetItemId` is the sub item of the same kind under the
 * pointer (before/after it); without it the item is appended to the node's list.
 */
export function resolveSubItemDrop(
  root: TreeNode,
  kind: SubItemKind,
  targetNodeId: string,
  targetItemId: string | undefined,
  position: Exclude<DropPosition, 'inside'>,
): SubItemDropTarget | undefined {
  const node = findNode(root, targetNodeId);
  if (!node) {
    return undefined;
  }
  const items = getSubItems(node, kind);
  if (targetItemId === undefined) {
    return { nodeId: node.id, index: items.length };
  }
  const index = items.findIndex((item) => item.id === targetItemId);
  if (index < 0) {
    return undefined;
  }
  return { nodeId: node.id, index: position === 'before' ? index : index + 1 };
}

/** True when the sub item drop would leave the tree unchanged. */
export function isNoopSubItemDrop(
  root: TreeNode,
  kind: SubItemKind,
  nodeId: string,
  itemId: string,
  drop: SubItemDropTarget,
): boolean {
  if (nodeId !== drop.nodeId) {
    return false;
  }
  const node = findNode(root, nodeId);
  const from = node ? getSubItems(node, kind).findIndex((item) => item.id === itemId) : -1;
  return from >= 0 && (drop.index === from || drop.index === from + 1);
}

/** Moves a decorator/service to another position or node. False when nothing could be moved. */
export function moveSubItemTo(
  root: TreeNode,
  kind: SubItemKind,
  nodeId: string,
  itemId: string,
  drop: SubItemDropTarget,
): boolean {
  const fromNode = findNode(root, nodeId);
  const toNode = findNode(root, drop.nodeId);
  if (!fromNode || !toNode) {
    return false;
  }
  const fromItems = getSubItems(fromNode, kind);
  const toItems = getSubItems(toNode, kind);
  const fromIndex = fromItems.findIndex((item) => item.id === itemId);
  if (fromIndex < 0 || drop.index < 0 || drop.index > toItems.length) {
    return false;
  }
  const [item] = fromItems.splice(fromIndex, 1);
  const index = fromItems === toItems && fromIndex < drop.index ? drop.index - 1 : drop.index;
  toItems.splice(index, 0, item);
  return true;
}
