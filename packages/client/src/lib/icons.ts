/** Icon names (Font Awesome 6 Free solid) matching the query. Prefix matches come first, then shorter names. */
export function filterIcons(names: readonly string[], query: string, limit = 300): string[] {
  const q = query.trim().toLowerCase().replace(/^fa-/, '').replace(/\s+/g, '-');
  const matches = q === '' ? [...names] : names.filter((name) => name.includes(q));
  if (q !== '') {
    matches.sort((a, b) => {
      const prefix = Number(!a.startsWith(q)) - Number(!b.startsWith(q));
      return prefix !== 0 ? prefix : a.length - b.length || a.localeCompare(b);
    });
  }
  return matches.slice(0, limit);
}

/** Number of names matching the query (not limited). */
export function countIcons(names: readonly string[], query: string): number {
  return filterIcons(names, query, Number.MAX_SAFE_INTEGER).length;
}
