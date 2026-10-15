import type { ScenarioExpectJson, ScenarioJson } from '@owlbt/shared';

/*
 * Pure helpers for editing the scenario-test fields (`trees`, `maxTicks`, `expect`, ...) of a
 * scenario in the project editor. Unknown fields of `expect` are kept.
 */

/**
 * Parses an integer field. Empty text removes the field (undefined); text that is not a number
 * is rejected (null). Numbers are kept as typed so validation can point out bad values.
 */
export function parseNumberField(text: string): number | undefined | null {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** `expect` with one field changed; undefined removes the field. Returns undefined when empty. */
export function withExpectField<K extends keyof ScenarioExpectJson>(
  scenario: ScenarioJson,
  field: K,
  value: ScenarioExpectJson[K] | undefined,
): ScenarioExpectJson | undefined {
  const current =
    typeof scenario.expect === 'object' && scenario.expect !== null ? scenario.expect : {};
  const next: ScenarioExpectJson = { ...current };
  if (value === undefined) {
    delete next[field];
  } else {
    next[field] = value;
  }
  return Object.keys(next).length === 0 ? undefined : next;
}

/** The `trees` field as text: comma separated paths / globs. */
export function formatTrees(trees: ScenarioJson['trees']): string {
  if (typeof trees === 'string') return trees;
  return Array.isArray(trees) ? trees.join(', ') : '';
}

/** Comma separated paths / globs to the `trees` field; empty text removes it. */
export function parseTrees(text: string): string[] | undefined {
  const list = text
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
  return list.length === 0 ? undefined : list;
}
