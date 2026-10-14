import type { Selection, SubItem, SubItemKind, TreeNode } from './types';

function valueText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return String(value);
}

/** Texts of an item that the tree search looks at: type, label, comment and property values. */
export function searchableTexts(item: TreeNode | SubItem): string[] {
  const texts = [item.type];
  if (item.label) {
    texts.push(item.label);
  }
  if (item.comment) {
    texts.push(item.comment);
  }
  for (const value of Object.values(item.properties)) {
    texts.push(valueText(value));
  }
  return texts;
}

/** Case-insensitive substring match of a (trimmed, non-empty) query against the item's texts. */
export function itemMatches(item: TreeNode | SubItem, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return false;
  }
  return searchableTexts(item).some((text) => text.toLowerCase().includes(needle));
}

/**
 * Finds the items matching `query` in visual order: a node, its decorators, its services, then
 * its children (depth first). A node matches by its own texts; decorators and services are separate
 * results so the search can select them. An empty query matches nothing.
 */
export function searchTree(root: TreeNode, query: string): Selection[] {
  const results: Selection[] = [];
  if (query.trim() === '') {
    return results;
  }
  const visitSubItems = (node: TreeNode, kind: SubItemKind, items: SubItem[]): void => {
    for (const item of items) {
      if (itemMatches(item, query)) {
        results.push({ kind, nodeId: node.id, itemId: item.id });
      }
    }
  };
  const visit = (node: TreeNode): void => {
    if (itemMatches(node, query)) {
      results.push({ kind: 'node', nodeId: node.id });
    }
    visitSubItems(node, 'decorator', node.decorators);
    visitSubItems(node, 'service', node.services);
    for (const child of node.childNodes) {
      visit(child);
    }
  };
  visit(root);
  return results;
}

/** Key of a search result: the node id for nodes, the item id for decorators and services. */
export function selectionKey(selection: Selection): string {
  return selection.kind === 'node' ? selection.nodeId : selection.itemId;
}
