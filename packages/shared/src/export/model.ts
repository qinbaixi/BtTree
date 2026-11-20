import type { ItemKind } from '../types';

/** An Erlang atom / Lua string that is written as a name (enum values, types, sub types). */
export interface ExportAtom {
  atom: string;
}

/** An ordered key/value map. Serialized as an Erlang map or a Lua table. */
export interface ExportMap {
  map: Array<[string, ExportValue]>;
}

/** Value of the export model. Plain objects are never used: maps and atoms are explicit. */
export type ExportValue = null | boolean | number | string | ExportAtom | ExportValue[] | ExportMap;

export type ExportField = [string, ExportValue];

/** One exported item (node, decorator or service) with its ordered top-level fields. */
export interface ExportEntry {
  id: number;
  kind: ItemKind;
  /** `<Type>[ - <label>]`, without the comment marker. */
  comment: string;
  fields: ExportField[];
}

export interface ExportModel {
  rootId: number;
  entries: ExportEntry[];
  /** Non-fatal problems, e.g. invalid property values. */
  warnings: string[];
}

/** Thrown when a tree cannot be exported (e.g. an item type is missing from the project). */
export class ExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportError';
  }
}

export function atom(name: string): ExportAtom {
  return { atom: name };
}

export function isExportAtom(value: ExportValue): value is ExportAtom {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'atom' in value;
}

export function isExportMap(value: ExportValue): value is ExportMap {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'map' in value;
}

/**
 * Converts arbitrary JSON-like data (e.g. constant `fields` of a type) to an export value.
 * Strings stay strings; undefined inside arrays becomes null.
 */
export function toExportValue(value: unknown): ExportValue {
  if (value === undefined || value === null) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map((item) => toExportValue(item));
  }
  if (typeof value === 'object') {
    return {
      map: Object.entries(value)
        .filter(([, inner]) => inner !== undefined)
        .map(([key, inner]): [string, ExportValue] => [key, toExportValue(inner)]),
    };
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  return null;
}

export const INT32_MIN = -(2 ** 31);
export const INT32_MAX = 2 ** 31 - 1;
export const INT64_MIN = -(2 ** 63);
export const INT64_LIMIT = 2 ** 63;

/**
 * Deduplicates ordered key/value pairs so that when a key repeats (e.g. from `export.fields` or a
 * property's `exportName` reusing a generated field), the last value wins at the position of the
 * first occurrence.
 */
export function lastWins(pairs: Array<[string, ExportValue]>): Array<[string, ExportValue]> {
  const byKey = new Map<string, ExportValue>();
  for (const [key, value] of pairs) {
    byKey.set(key, value);
  }
  return byKey.size === pairs.length ? pairs : [...byKey];
}

/** True when every element is an integer that fits in a signed 32-bit integer. */
export function isInt32List(values: ExportValue[]): boolean {
  return values.every(
    (item) =>
      typeof item === 'number' && Number.isInteger(item) && item >= INT32_MIN && item <= INT32_MAX,
  );
}

/** Line terminators and NUL/BOM characters that must not appear raw in single-line comments. */
const COMMENT_UNSAFE = new RegExp('[\\r\\n\\u0085\\u2028\\u2029\\ufeff]+', 'g');

/** Keeps comment text on a single safe line (strips NUL, BOM and Unicode line terminators). */
export function sanitizeLineComment(text: string): string {
  return text.split('\0').join(' ').replace(COMMENT_UNSAFE, ' ');
}

/** Cached results are dropped when there are more than this many (keys and atoms repeat a lot). */
const FORMAT_CACHE_LIMIT = 1000;

/**
 * Remembers the results of a name formatter (object keys, atoms). An export writes the same few
 * keys and type names for every entry, so each one is escaped and checked only once.
 */
export function cachedFormatter(format: (name: string) => string): (name: string) => string {
  const cache = new Map<string, string>();
  return (name) => {
    let text = cache.get(name);
    if (text === undefined) {
      text = format(name);
      if (cache.size >= FORMAT_CACHE_LIMIT) {
        cache.clear();
      }
      cache.set(name, text);
    }
    return text;
  };
}
