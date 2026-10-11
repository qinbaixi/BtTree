import { createHash } from 'node:crypto';

/** Hex sha256 of the text. Used to detect that owl-bt.json changed since the editor loaded it. */
export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Indentation of a JSON text: '\t' when the first indented line starts with a tab, otherwise the
 * number of spaces of that line. Undefined when no line is indented.
 */
export function indentOf(text: string): string | number | undefined {
  for (const line of text.split(/\r?\n/)) {
    const match = /^([ \t]+)\S/.exec(line);
    if (!match) {
      continue;
    }
    if (match[1].startsWith('\t')) {
      return '\t';
    }
    return Math.min(match[1].length, 10);
  }
  return undefined;
}

/** Indentation of a JSON text. Defaults to 4 spaces when no line is indented. */
export function detectIndent(text: string): string | number {
  return indentOf(text) ?? 4;
}

/** Longest line produced when collapsing a short array onto one line (matches the repo's Prettier width). */
const INLINE_ARRAY_WIDTH = 100;

/** A JSON string, number, boolean or null literal. */
const PRIMITIVE = String.raw`(?:"(?:[^"\\\n]|\\.)*"|-?\d[\d.eE+-]*|true|false|null)`;

/** A multi-line array (as written by JSON.stringify) whose items are all primitives. */
const PRIMITIVE_ARRAY = new RegExp(
  String.raw`^([^\n]*)\[\n((?:[ \t]*${PRIMITIVE},?\n)+)[ \t]*\]`,
  'gm',
);

/** True when the original text writes at least one array of plain values on a single line. */
function usesInlineArrays(original: string): boolean {
  return new RegExp(String.raw`\[[ \t]*${PRIMITIVE}[ \t]*,[^\n]*\]`).test(original);
}

/** Puts arrays of plain values on one line when the line stays within INLINE_ARRAY_WIDTH. */
function inlineShortArrays(text: string): string {
  return text.replace(PRIMITIVE_ARRAY, (whole, prefix: string, body: string) => {
    const items = body
      .split('\n')
      .map((line) => line.trim().replace(/,$/, ''))
      .filter((item) => item !== '');
    const inline = `${prefix}[${items.join(', ')}]`;
    return inline.length <= INLINE_ARRAY_WIDTH ? inline : whole;
  });
}

/**
 * Serializes JSON for writing over an existing file. Keeps the indentation and line endings of the
 * original text, keeps short arrays on one line when the original does so, and ends with a newline
 * only when the original did. Without an original (a new file), or when the original has no
 * indented line, `fallbackIndent` is used.
 */
export function formatJsonLike(
  content: unknown,
  original: string | undefined,
  fallbackIndent: string | number = 4,
): string {
  const source = original ?? '';
  const crlf = source.includes('\r\n');
  let text = JSON.stringify(content, null, indentOf(source) ?? fallbackIndent);
  if (usesInlineArrays(source)) {
    text = inlineShortArrays(text);
  }
  if (crlf) {
    text = text.replace(/\n/g, '\r\n');
  }
  return source.endsWith('\n') ? `${text}${crlf ? '\r\n' : '\n'}` : text;
}
