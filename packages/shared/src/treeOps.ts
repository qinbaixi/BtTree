import type {
  BasePropertyName,
  CompiledItemType,
  Selection,
  SubItem,
  SubItemKind,
  TreeNode,
} from './types';

/** Visits the node and all its descendants (pre-order). */
export function forEachNode(root: TreeNode, fn: (node: TreeNode) => void): void {
  fn(root);
  for (const child of root.childNodes) {
    forEachNode(child, fn);
  }
}

/** Finds a node by id in the tree rooted at `root`. */
export function findNode(root: TreeNode, id: string): TreeNode | undefined {
  if (root.id === id) {
    return root;
  }
  for (const child of root.childNodes) {
    const found = findNode(child, id);
    if (found) {
      return found;
    }
  }
  return undefined;
}

/** Returns the path from root to the node (inclusive), or [] if not found. */
export function findNodePath(root: TreeNode, id: string): TreeNode[] {
  if (root.id === id) {
    return [root];
  }
  for (const child of root.childNodes) {
    const sub = findNodePath(child, id);
    if (sub.length > 0) {
      return [root, ...sub];
    }
  }
  return [];
}

/** Returns the parent of the node with the given id (undefined for root or unknown ids). */
export function findParent(root: TreeNode, id: string): TreeNode | undefined {
  const path = findNodePath(root, id);
  return path.length > 1 ? path[path.length - 2] : undefined;
}

/** Returns the live decorators or services array of a node. */
export function getSubItems(node: TreeNode, kind: SubItemKind): SubItem[] {
  return kind === 'decorator' ? node.decorators : node.services;
}

export function findSubItem(
  node: TreeNode,
  kind: SubItemKind,
  itemId: string,
): SubItem | undefined {
  return getSubItems(node, kind).find((item) => item.id === itemId);
}

/** Inserts a child node at `index` (appended when omitted). */
export function addChildNode(parent: TreeNode, child: TreeNode, index?: number): void {
  parent.childNodes.splice(index ?? parent.childNodes.length, 0, child);
}

/**
 * Removes a node (and its subtree) from the tree.
 * Returns the parent id and former index, or undefined if the node is not found.
 * @throws when trying to remove the root.
 */
export function removeNode(
  root: TreeNode,
  id: string,
): { parentId: string; index: number } | undefined {
  if (root.id === id) {
    throw new Error('Root node cannot be removed');
  }
  const parent = findParent(root, id);
  if (!parent) {
    return undefined;
  }
  const index = parent.childNodes.findIndex((child) => child.id === id);
  if (index < 0) {
    return undefined;
  }
  parent.childNodes.splice(index, 1);
  return { parentId: parent.id, index };
}

function moveInArray<T>(array: T[], index: number, delta: number): boolean {
  const target = index + delta;
  if (index < 0 || target < 0 || target >= array.length) {
    return false;
  }
  const [item] = array.splice(index, 1);
  array.splice(target, 0, item);
  return true;
}

/** Swaps a node with its sibling (delta -1 = up/left, 1 = down/right). False at bounds or for root. */
export function moveNode(root: TreeNode, id: string, delta: -1 | 1): boolean {
  const parent = findParent(root, id);
  if (!parent) {
    return false;
  }
  const index = parent.childNodes.findIndex((child) => child.id === id);
  return moveInArray(parent.childNodes, index, delta);
}

export function addSubItem(node: TreeNode, kind: SubItemKind, item: SubItem, index?: number): void {
  const items = getSubItems(node, kind);
  items.splice(index ?? items.length, 0, item);
}

/** Removes a sub item. Returns its former index, or -1 if not found. */
export function removeSubItem(node: TreeNode, kind: SubItemKind, itemId: string): number {
  const items = getSubItems(node, kind);
  const index = items.findIndex((item) => item.id === itemId);
  if (index < 0) {
    return -1;
  }
  items.splice(index, 1);
  return index;
}

/** Moves a sub item within its list. False at bounds or when not found. */
export function moveSubItem(
  node: TreeNode,
  kind: SubItemKind,
  itemId: string,
  delta: -1 | 1,
): boolean {
  const items = getSubItems(node, kind);
  const index = items.findIndex((item) => item.id === itemId);
  return moveInArray(items, index, delta);
}

/** Sets a custom property value. null/undefined removes the key. */
export function setPropertyValue(
  item: { properties: Record<string, unknown> },
  name: string,
  value: unknown,
): void {
  if (value === undefined || value === null) {
    delete item.properties[name];
  } else {
    item.properties[name] = value;
  }
}

/** Sets a base property (label, comment, periodic, ...). null/undefined removes the field. */
export function setBaseProperty(
  item: Partial<Record<BasePropertyName, unknown>>,
  name: BasePropertyName,
  value: unknown,
): void {
  if (value === undefined || value === null) {
    delete item[name];
  } else {
    item[name] = value;
  }
}

/**
 * Changes the node type. Custom property values that are not declared by the new type are removed.
 * @returns the removed values keyed by property name
 */
export function setNodeType(
  node: TreeNode,
  type: string,
  compiledType: CompiledItemType,
): Record<string, unknown> {
  const declared = new Set(compiledType.properties.map((p) => p.name));
  const removed: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(node.properties)) {
    if (!declared.has(name)) {
      removed[name] = value;
      delete node.properties[name];
    }
  }
  node.type = type;
  return removed;
}

function lastSubItemOrHeader(node: TreeNode): Selection {
  if (node.services.length > 0) {
    return { kind: 'service', nodeId: node.id, itemId: node.services[node.services.length - 1].id };
  }
  if (node.decorators.length > 0) {
    return {
      kind: 'decorator',
      nodeId: node.id,
      itemId: node.decorators[node.decorators.length - 1].id,
    };
  }
  return { kind: 'node', nodeId: node.id };
}

/**
 * Returns the item rendered directly above the selection in visual order
 * (parent node / decorators / services / child nodes), or undefined if there is none.
 * Also used to determine which item is selected after removing `sel`.
 */
export function itemAbove(root: TreeNode, sel: Selection): Selection | undefined {
  if (sel.kind === 'node') {
    const parent = findParent(root, sel.nodeId);
    return parent ? lastSubItemOrHeader(parent) : undefined;
  }

  const node = findNode(root, sel.nodeId);
  if (!node) {
    return undefined;
  }
  const items = getSubItems(node, sel.kind);
  const index = items.findIndex((item) => item.id === sel.itemId);
  if (index < 0) {
    return undefined;
  }
  if (index > 0) {
    return { kind: sel.kind, nodeId: node.id, itemId: items[index - 1].id };
  }
  if (sel.kind === 'service' && node.decorators.length > 0) {
    return {
      kind: 'decorator',
      nodeId: node.id,
      itemId: node.decorators[node.decorators.length - 1].id,
    };
  }
  return { kind: 'node', nodeId: node.id };
}
