function normalizeIconQuery(query: string): string {
  return query.trim().toLowerCase().replace(/^fa-/, '').replace(/\s+/g, '-');
}

/** Icon names (Font Awesome 6 Free solid) matching the query. Prefix matches come first, then shorter names. */
export function filterIcons(names: readonly string[], query: string, limit = 300): string[] {
  const q = normalizeIconQuery(query);
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
  const q = normalizeIconQuery(query);
  if (q === '') {
    return names.length;
  }
  let count = 0;
  for (const name of names) {
    if (name.includes(q)) {
      count++;
    }
  }
  return count;
}
