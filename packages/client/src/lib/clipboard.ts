import type { SubItemJson, TreeNodeJson } from '@owlbt/shared';
import { getJson, setJson } from './storage';

/** localStorage key of the tree clipboard. */
export const CLIPBOARD_KEY = 'tree';

/** A copied tree item in its JSON (file) form. */
export type ClipboardPayload =
  | { itemType: 'node'; item: TreeNodeJson }
  | { itemType: 'decorator' | 'service'; item: SubItemJson };

export function writeClipboard(payload: ClipboardPayload): void {
  setJson(CLIPBOARD_KEY, payload);
}

/** Returns the copied item, or undefined when the clipboard is empty or holds something unusable. */
export function readClipboard(): ClipboardPayload | undefined {
  const raw = getJson<unknown>(CLIPBOARD_KEY, undefined);
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const { itemType, item } = raw as { itemType?: unknown; item?: unknown };
  if (typeof item !== 'object' || item === null || Array.isArray(item)) {
    return undefined;
  }
  if (typeof (item as { type?: unknown }).type !== 'string') {
    return undefined;
  }
  if (itemType === 'node') {
    return { itemType: 'node', item: item as TreeNodeJson };
  }
  if (itemType === 'decorator' || itemType === 'service') {
    return { itemType, item: item as SubItemJson };
  }
  return undefined;
}
