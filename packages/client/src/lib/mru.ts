import { getJson, setJson } from './storage';

/** Storage key kept identical to the original app so existing MRU lists survive the rewrite. */
export const MRU_STORAGE_KEY = 'TreeMruList.items';
export const MRU_MAX_ITEM_COUNT = 20;

export interface MruItem {
  path: string;
}

function isMruItem(value: unknown): value is MruItem {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { path?: unknown }).path === 'string'
  );
}

/** Newest first. Malformed entries are dropped. */
export function getMruList(): MruItem[] {
  const stored = getJson<unknown>(MRU_STORAGE_KEY, []);
  return Array.isArray(stored) ? stored.filter(isMruItem) : [];
}

/** Moves the path to the front (deduplicated) and trims the list to the max size. */
export function registerMru(treePath: string): MruItem[] {
  const items = [{ path: treePath }, ...getMruList().filter((item) => item.path !== treePath)];
  const trimmed = items.slice(0, MRU_MAX_ITEM_COUNT);
  setJson(MRU_STORAGE_KEY, trimmed);
  return trimmed;
}

export function removeMru(treePath: string): MruItem[] {
  const items = getMruList().filter((item) => item.path !== treePath);
  setJson(MRU_STORAGE_KEY, items);
  return items;
}

/** Last segment of a path, accepting both forward and back slashes as separators. */
export function getPathLastSegment(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return index < 0 ? path : path.slice(index + 1);
}
