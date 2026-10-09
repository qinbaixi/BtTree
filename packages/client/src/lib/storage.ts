/**
 * Tiny JSON helpers over localStorage. Every access is guarded so that a blocked or full
 * storage (private mode, sandboxed iframes, quota errors) degrades to defaults instead of throwing.
 */

export function getStorageItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function setStorageItem(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignored: persistence is best effort.
  }
}

export function removeStorageItem(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignored: persistence is best effort.
  }
}

/** Returns the parsed value, or `fallback` when the key is missing or the JSON is invalid. */
export function getJson<T>(key: string, fallback: T): T {
  const raw = getStorageItem(key);
  if (raw === null) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function setJson(key: string, value: unknown): void {
  setStorageItem(key, JSON.stringify(value));
}
