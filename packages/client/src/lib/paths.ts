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
