import type { ItemKind, Selection, TreeNode } from '@owlbt/shared';

/** An item of a tree file by position: the node's child indexes from the root, and a sub item. */
export interface TreeItemRef {
  nodePath: readonly number[];
  itemKind: ItemKind;
  /** Index of the decorator / service. */
  itemIndex?: number;
}

/**
 * `select` URL value of a tree item: `node:0.2` (root: `node:`), `decorator:0.2:1`,
 * `service::0` (a service of the root).
 */
export function formatSelectParam(ref: TreeItemRef): string {
  const path = ref.nodePath.join('.');
  if (ref.itemKind === 'node') {
    return `node:${path}`;
  }
  return `${ref.itemKind}:${path}:${ref.itemIndex ?? 0}`;
}

function parseIndex(text: string): number | undefined {
  if (!/^\d+$/.test(text)) {
    return undefined;
  }
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : undefined;
}

/** Parses a `select` URL value. Undefined when malformed. */
export function parseSelectParam(value: string | null | undefined): TreeItemRef | undefined {
  if (!value) {
    return undefined;
  }
  const [kind, path = '', index, ...rest] = value.split(':');
  if (rest.length > 0 || (kind !== 'node' && kind !== 'decorator' && kind !== 'service')) {
    return undefined;
  }
  const nodePath: number[] = [];
  for (const part of path === '' ? [] : path.split('.')) {
    const parsed = parseIndex(part);
    if (parsed === undefined) {
      return undefined;
    }
    nodePath.push(parsed);
  }
  if (kind === 'node') {
    return index === undefined ? { nodePath, itemKind: 'node' } : undefined;
  }
  const itemIndex = index === undefined ? undefined : parseIndex(index);
  return itemIndex === undefined ? undefined : { nodePath, itemKind: kind, itemIndex };
}

/** URL of the tree editor, optionally selecting an item when the tree has loaded. */
export function treeEditorUrl(path: string, select?: TreeItemRef): string {
  const params = new URLSearchParams({ path });
  if (select) {
    params.set('select', formatSelectParam(select));
  }
  return `/tree?${params.toString()}`;
}

/** Selection of the referenced item in a loaded tree. Undefined when the tree has no such item. */
export function resolveTreeItemRef(root: TreeNode, ref: TreeItemRef): Selection | undefined {
  let node: TreeNode | undefined = root;
  for (const index of ref.nodePath) {
    node = node.childNodes[index];
    if (!node) {
      return undefined;
    }
  }
  if (ref.itemKind === 'node') {
    return { kind: 'node', nodeId: node.id };
  }
  const list = ref.itemKind === 'decorator' ? node.decorators : node.services;
  const item = list[ref.itemIndex ?? 0];
  return item ? { kind: ref.itemKind, nodeId: node.id, itemId: item.id } : undefined;
}
