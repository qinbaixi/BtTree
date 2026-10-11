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

/** TypeScript string literal with single quotes. Control characters use `\uXXXX`. */
export function tsString(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === '\\' || ch === "'") {
      out += `\\${ch}`;
    } else if (ch === '\n') {
      out += '\\n';
    } else if (ch === '\r') {
      out += '\\r';
    } else if (ch === '\t') {
      out += '\\t';
    } else if (code < 0x20 || code === 0x7f) {
      out += `\\u${code.toString(16).padStart(4, '0')}`;
    } else {
      out += ch;
    }
  }
  return `'${out}'`;
}

/** TypeScript object key: bare when it is a valid identifier, a single-quoted string otherwise. */
export function tsKey(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : tsString(name);
}

const CSHARP_KEYWORDS: ReadonlySet<string> = new Set([
  'abstract',
  'as',
  'base',
  'bool',
  'break',
  'byte',
  'case',
  'catch',
  'char',
  'checked',
  'class',
  'const',
  'continue',
  'decimal',
  'default',
  'delegate',
  'do',
  'double',
  'else',
  'enum',
  'event',
  'explicit',
  'extern',
  'false',
  'finally',
  'fixed',
  'float',
  'for',
  'foreach',
  'goto',
  'if',
  'implicit',
  'in',
  'int',
  'interface',
  'internal',
  'is',
  'lock',
  'long',
  'namespace',
  'new',
  'null',
  'object',
  'operator',
  'out',
  'override',
  'params',
  'private',
  'protected',
  'public',
  'readonly',
  'ref',
  'return',
  'sbyte',
  'sealed',
  'short',
  'sizeof',
  'stackalloc',
  'static',
  'string',
  'struct',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'uint',
  'ulong',
  'unchecked',
  'unsafe',
  'ushort',
  'using',
  'virtual',
  'void',
  'volatile',
  'while',
]);

/** C# string literal with double quotes. Control characters use `\uXXXX`. */
export function csharpString(text: string): string {
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
      out += `\\u${code.toString(16).padStart(4, '0')}`;
    } else {
      out += ch;
    }
  }
  return `"${out}"`;
}

/**
 * Makes a valid C# identifier: non [A-Za-z0-9_] characters are removed, a leading digit gets a `_`
 * prefix and C# keywords get the `@` prefix (`@class`).
 */
export function csharpIdentifier(name: string): string {
  let id = name.replace(/[^A-Za-z0-9_]/g, '');
  if (id === '') {
    id = '_';
  } else if (/^[0-9]/.test(id)) {
    id = `_${id}`;
  }
  return CSHARP_KEYWORDS.has(id) ? `@${id}` : id;
}

/**
 * C# class name from a file name: words separated by any non-alphanumeric character, each with an
 * upper case first letter (`bt_mon_1000` -> `BtMon1000`). Passed through csharpIdentifier.
 */
export function csharpClassName(fileName: string): string {
  const pascal = fileName
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word !== '')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
  return csharpIdentifier(pascal === '' ? 'BehaviorTree' : pascal);
}

export const DEFAULT_CS_NAMESPACE = 'BehaviorTrees';

const CSHARP_NAMESPACE_SEGMENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** True for dotted C# identifiers without keywords, e.g. `Game.BehaviorTrees`. */
function isCsNamespace(name: string): boolean {
  return name
    .split('.')
    .every((segment) => CSHARP_NAMESPACE_SEGMENT.test(segment) && !CSHARP_KEYWORDS.has(segment));
}

/**
 * Validates the `export.cs.namespace` setting: dotted C# identifiers. Anything else falls back to
 * DEFAULT_CS_NAMESPACE and comes back with a warning.
 */
export function parseCsNamespace(raw: unknown): { namespace: string; warning?: string } {
  if (raw === undefined) {
    return { namespace: DEFAULT_CS_NAMESPACE };
  }
  if (typeof raw === 'string' && isCsNamespace(raw)) {
    return { namespace: raw };
  }
  return {
    namespace: DEFAULT_CS_NAMESPACE,
    warning: `Invalid C# namespace ${JSON.stringify(raw)}, using ${DEFAULT_CS_NAMESPACE}`,
  };
}

/** Go keywords; package names must not be one of them. */
const GO_KEYWORDS: ReadonlySet<string> = new Set([
  'break',
  'case',
  'chan',
  'const',
  'continue',
  'default',
  'defer',
  'else',
  'fallthrough',
  'for',
  'func',
  'go',
  'goto',
  'if',
  'import',
  'interface',
  'map',
  'package',
  'range',
  'return',
  'select',
  'struct',
  'switch',
  'type',
  'var',
]);

/**
 * Text that goString can quote as is: no quote, backslash, control character, byte order mark or
 * surrogate (surrogate pairs take the slow path too, which leaves them unchanged).
 */
// eslint-disable-next-line no-control-regex
const GO_STRING_PLAIN = /^[^"\\\x00-\x1f\x7f\ufeff\ud800-\udfff]*$/;

/**
 * Go interpreted string literal. Control characters use `\xHH`; a byte order mark and lone
 * surrogates (which Go source cannot hold) become `\uFEFF` and `\uFFFD`.
 */
export function goString(text: string): string {
  if (GO_STRING_PLAIN.test(text)) {
    return `"${text}"`;
  }
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
      out += `\\x${code.toString(16).padStart(2, '0')}`;
    } else if (code === 0xfeff) {
      out += '\\uFEFF';
    } else if (code >= 0xd800 && code <= 0xdfff) {
      out += '\\uFFFD';
    } else {
      out += ch;
    }
  }
  return `"${out}"`;
}

/**
 * Exported Go identifier prefix from a file name: words separated by anything that is not a letter
 * or digit, each with an upper case first letter (`bt_mon_1000` -> `BtMon1000`). Go identifiers may
 * hold any Unicode letter, so non-ASCII names keep their text (`巡逻_a` -> `Bt巡逻A`). A `Bt` prefix
 * is added when the result does not start with an upper case letter, so the name stays exported.
 */
export function goNamePrefix(fileName: string): string {
  const pascal = fileName
    .split(/[^\p{L}\p{Nd}]+/u)
    .filter((word) => word !== '')
    .map((word) => {
      const [first, ...rest] = word;
      return first.toUpperCase() + rest.join('');
    })
    .join('');
  if (pascal === '') {
    return 'BehaviorTree';
  }
  return /^\p{Lu}/u.test(pascal) ? pascal : `Bt${pascal}`;
}

export const DEFAULT_GO_PACKAGE = 'behaviortrees';

/**
 * Validates the `export.go.package` setting: a Go identifier that is not a keyword or `_`.
 * Anything else falls back to DEFAULT_GO_PACKAGE and comes back with a warning.
 */
export function parseGoPackage(raw: unknown): { package: string; warning?: string } {
  if (raw === undefined) {
    return { package: DEFAULT_GO_PACKAGE };
  }
  if (
    typeof raw === 'string' &&
    /^[A-Za-z_][A-Za-z0-9_]*$/.test(raw) &&
    raw !== '_' &&
    !GO_KEYWORDS.has(raw)
  ) {
    return { package: raw };
  }
  return {
    package: DEFAULT_GO_PACKAGE,
    warning: `Invalid Go package ${JSON.stringify(raw)}, using ${DEFAULT_GO_PACKAGE}`,
  };
}
