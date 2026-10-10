/** Splits a camel/Pascal name into lower case words joined by '_': `RandomSelector` -> `random_selector`. */
export function snakeCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

const ERLANG_RESERVED_WORDS: ReadonlySet<string> = new Set([
  'after',
  'and',
  'andalso',
  'band',
  'begin',
  'bnot',
  'bor',
  'bsl',
  'bsr',
  'bxor',
  'case',
  'catch',
  'cond',
  'div',
  'end',
  'fun',
  'if',
  'let',
  'not',
  'of',
  'or',
  'orelse',
  'receive',
  'rem',
  'try',
  'when',
  'xor',
]);

const LUA_KEYWORDS: ReadonlySet<string> = new Set([
  'and',
  'break',
  'do',
  'else',
  'elseif',
  'end',
  'false',
  'for',
  'function',
  'goto',
  'if',
  'in',
  'local',
  'nil',
  'not',
  'or',
  'repeat',
  'return',
  'then',
  'true',
  'until',
  'while',
]);

/** Escapes control characters as `\x{HEX}` (Erlang) so the result can sit inside a quoted literal. */
function escapeErlangChars(text: string, quote: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === '\\' || ch === quote) {
      out += `\\${ch}`;
    } else if (ch === '\n') {
      out += '\\n';
    } else if (ch === '\r') {
      out += '\\r';
    } else if (ch === '\t') {
      out += '\\t';
    } else if (code < 0x20 || code === 0x7f) {
      out += `\\x{${code.toString(16).toUpperCase()}}`;
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Erlang atom source. Plain lowercase atoms stay as they are; everything else (upper case, spaces,
 * reserved words, ...) is quoted: `'Like This'`.
 */
export function erlangAtom(name: string): string {
  if (/^[a-z][a-z0-9_]*$/.test(name) && !ERLANG_RESERVED_WORDS.has(name)) {
    return name;
  }
  return `'${escapeErlangChars(name, "'")}'`;
}

/** Erlang string literal: `<<"text"/utf8>>`. */
export function erlangString(text: string): string {
  return `<<"${escapeErlangChars(text, '"')}"/utf8>>`;
}

/** Lua string literal with double quotes. Control characters use the decimal `\ddd` form. */
export function luaString(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === '\\' || ch === '"') {
      out += `\\${ch}`;
    } else if (ch === '\n') {
      out += '\\n';
    } else if (ch === '\r') {
      out += '\\r';
    } else if (ch === '\t') {
      out += '\\t';
    } else if (code < 0x20 || code === 0x7f) {
      out += `\\${String(code).padStart(3, '0')}`;
    } else {
      out += ch;
    }
  }
  return `"${out}"`;
}

/** Lua table key: `name = ` when it is a valid identifier, `["name"] = ` otherwise. */
export function luaKey(name: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !LUA_KEYWORDS.has(name)) {
    return name;
  }
  return `[${luaString(name)}]`;
}

/**
 * Erlang module name from a file name: lower case, every character outside [a-z0-9_] becomes '_',
 * and an `m_` prefix is added when the result does not start with a letter.
 */
export function sanitizeModuleName(name: string): string {
  const sanitized = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  return /^[a-z]/.test(sanitized) ? sanitized : `m_${sanitized}`;
}
