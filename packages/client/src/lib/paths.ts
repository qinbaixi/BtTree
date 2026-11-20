/**
 * Normalizes a path for equality checks across slash styles and Windows drive-letter casing
 * (`C:\A\b.json` and `c:/a/b.json` produce the same key; POSIX paths remain case-sensitive).
 */
export function normalizePathKey(path: string): string {
  const unified = path.replace(/\\/g, '/');
  return /^[A-Za-z]:\//.test(unified) ? unified.toLowerCase() : unified;
}

/** Same file path, tolerating slash style and Windows drive-letter casing differences. */
export function samePath(a: string, b: string): boolean {
  return normalizePathKey(a) === normalizePathKey(b);
}

/** True when the path names a .json file (case-insensitive). */
export function isJsonPath(path: string): boolean {
  return /\.json$/i.test(path.trim());
}

/**
 * Joins a folder and a relative file name using the folder's separator style.
 * Accepts either slash style in `relative`, e.g. `trees/my-tree.json`.
 */
export function joinPath(dir: string, relative: string): string {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
  const base = dir.replace(/[\\/]+$/, '');
  const parts = relative
    .trim()
    .split(/[\\/]+/)
    .filter((part) => part !== '');
  return [base, ...parts].join(sep);
}
