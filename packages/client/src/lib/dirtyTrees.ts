import { getJson, setJson } from './storage';

/**
 * Trees with unsaved edits, shared between the tabs of the browser through localStorage, so that
 * a batch rename in the project editor can leave them alone. Best effort: entries of tabs that
 * closed without cleaning up expire after MAX_AGE_MS.
 */

export const DIRTY_TREES_KEY = 'owlbt.dirtyTrees';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

interface DirtyEntry {
  path: string;
  tab: string;
  at: number;
}

/** Id of this tab (one per page load). */
const TAB_ID = Math.random().toString(36).slice(2);

function readEntries(now: number): DirtyEntry[] {
  const raw = getJson<unknown>(DIRTY_TREES_KEY, []);
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(
    (entry): entry is DirtyEntry =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as DirtyEntry).path === 'string' &&
      typeof (entry as DirtyEntry).tab === 'string' &&
      typeof (entry as DirtyEntry).at === 'number' &&
      now - (entry as DirtyEntry).at < MAX_AGE_MS,
  );
}

/** Records (or clears) that this tab has unsaved edits of the tree. */
export function markTreeDirty(path: string, dirty: boolean, now = Date.now()): void {
  const others = readEntries(now).filter((entry) => !(entry.tab === TAB_ID && entry.path === path));
  setJson(DIRTY_TREES_KEY, dirty ? [...others, { path, tab: TAB_ID, at: now }] : others);
}

/** Paths of trees with unsaved edits in any tab. */
export function getDirtyTreePaths(now = Date.now()): string[] {
  return [...new Set(readEntries(now).map((entry) => entry.path))];
}
