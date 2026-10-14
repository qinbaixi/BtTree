import type { TreeNodeJson } from '@owlbt/shared';
import { formatJsonLike } from './projectFile';

export const UTF8_BOM = String.fromCharCode(0xfeff);

/** Parses the text of a tree file (a leading UTF-8 BOM is ignored). Throws on invalid JSON. */
export function parseTreeText(raw: string): TreeNodeJson {
  return JSON.parse(raw.startsWith(UTF8_BOM) ? raw.slice(1) : raw) as TreeNodeJson;
}

/**
 * Text written for a tree. A new file (no original) gets tab indentation. An existing file keeps its
 * indentation, line endings and BOM.
 */
export function formatTreeText(tree: unknown, original: string | undefined): string {
  const hasBom = original?.startsWith(UTF8_BOM) === true;
  const text = formatJsonLike(tree, hasBom ? original?.slice(1) : original, '\t');
  return hasBom ? `${UTF8_BOM}${text}` : text;
}
