import {
  isExportAtom,
  isExportMap,
  type ExportEntry,
  type ExportModel,
  type ExportValue,
} from './model';
import { goString } from './names';

export interface GoOptions {
  /** Tree file path relative to the project directory, forward slashes. */
  sourcePath: string;
  /** Go package name (validated with parseGoPackage). */
  packageName: string;
  /** Exported prefix of the generated identifiers (see goNamePrefix), e.g. `BtMon1000`. */
  namePrefix: string;
}

/** Top-level entry fields that hold lists of ids. */
const ID_LIST_FIELDS: ReadonlySet<string> = new Set(['decorators', 'services', 'children']);

const INT32_MIN = -(2 ** 31);
const INT32_MAX = 2 ** 31 - 1;
const INT64_MIN = -(2 ** 63);
const INT64_LIMIT = 2 ** 63;

/** Line terminators in comments; the byte order mark is not allowed in Go source (nor is NUL). */
const COMMENT_UNSAFE = new RegExp('[\\r\\n\\ufeff]+', 'g');

/**
 * Sizes of a key as gofmt sees it: `bytes` is the UTF-8 length (used by the alignment heuristic),
 * `width` the number of code points (used by the tabwriter for padding).
 */
function keySize(key: string): { bytes: number; width: number } {
  let bytes = 0;
  let width = 0;
  for (let i = 0; i < key.length; i++) {
    const code = key.charCodeAt(i);
    width++;
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < key.length) {
      // Surrogate pair: one code point, four bytes. (goString escapes lone surrogates.)
      bytes += 4;
      i++;
    } else {
      bytes += 3;
    }
  }
  return { bytes, width };
}

/** Tracks whether the generated code needs `import "math"` (NaN and infinities). */
interface Context {
  usesMath: boolean;
}

/** Indentation by depth; the output never nests deeper than three levels. */
const TABS = ['', '\t', '\t\t', '\t\t\t'];

/**
 * Go literal for a number inside `any`: int for int32 integers, int64(...) for other integers in the
 * int64 range, otherwise a float64 constant with a decimal point or exponent (`0.5`, `1e+21`).
 */
function goNumber(n: number, ctx: Context): string {
  if (Number.isInteger(n) && n >= INT32_MIN && n <= INT32_MAX) {
    return String(n);
  }
  if (Number.isInteger(n) && n >= INT64_MIN && n < INT64_LIMIT) {
    return `int64(${BigInt(n).toString()})`;
  }
  if (Number.isNaN(n)) {
    ctx.usesMath = true;
    return 'math.NaN()';
  }
  if (n === Infinity || n === -Infinity) {
    ctx.usesMath = true;
    return n > 0 ? 'math.Inf(1)' : 'math.Inf(-1)';
  }
  const text = String(n);
  return /[.e]/.test(text) ? text : `${text}.0`;
}

/** Single-line Go expression for an `any` slot. Atoms become strings. */
function inline(value: ExportValue, ctx: Context): string {
  if (value === null) {
    return 'nil';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    return goNumber(value, ctx);
  }
  if (typeof value === 'string') {
    return goString(value);
  }
  if (Array.isArray(value)) {
    return `[]any{${value.map((item) => inline(item, ctx)).join(', ')}}`;
  }
  if (isExportAtom(value)) {
    return goString(value.atom);
  }
  const pairs = value.map.map(([key, inner]) => `${goString(key)}: ${inline(inner, ctx)}`);
  return `map[string]any{${pairs.join(', ')}}`;
}

/** One `key: value` element of a composite literal. */
interface Pair {
  key: string;
  /** Single-line value including the trailing comma; undefined for a multi-line map. */
  value?: string;
  /** Elements of a multi-line map value. */
  inner?: Pair[];
}

/**
 * Writes the key/value elements of a composite literal, aligned the way gofmt aligns them:
 * consecutive single-line elements share a value column; multi-line elements break the run, and
 * keys longer than 40 bytes start a new run when they are far from the average key size of the
 * current run.
 */
function writePairs(out: string[], pairs: Pair[], depth: number): void {
  const indent = TABS[depth];
  const n = pairs.length;
  const widths = new Array<number>(n);
  // Index of the first element of the run each element belongs to (gofmt's exprList heuristic).
  const runStart = new Array<number>(n);
  let lnsum = 0;
  let count = 0;
  let prevSize = 0;
  for (let i = 0; i < n; i++) {
    const pair = pairs[i];
    let size = 0;
    if (pair.inner === undefined) {
      const key = keySize(pair.key);
      size = key.bytes;
      widths[i] = key.width;
    }
    let breakRun = true;
    if (prevSize > 0 && size > 0) {
      if (count === 0 || (prevSize <= 40 && size <= 40)) {
        breakRun = false;
      } else {
        const ratio = size / Math.exp(lnsum / count);
        breakRun = 2.5 * ratio <= 1 || 2.5 <= ratio;
      }
    }
    if (breakRun || i === 0) {
      // A new section restarts the average.
      runStart[i] = i;
      lnsum = 0;
      count = 0;
    } else {
      runStart[i] = runStart[i - 1];
    }
    if (size > 0) {
      lnsum += Math.log(size);
      count++;
    }
    prevSize = size;
  }

  let i = 0;
  while (i < n) {
    let end = i + 1;
    while (end < n && runStart[end] === i) {
      end++;
    }
    let width = 0;
    for (let j = i; j < end; j++) {
      if (pairs[j].inner === undefined && widths[j] > width) {
        width = widths[j];
      }
    }
    for (let j = i; j < end; j++) {
      const pair = pairs[j];
      if (pair.inner !== undefined) {
        out.push(`${indent}${pair.key}: map[string]any{`);
        writePairs(out, pair.inner, depth + 1);
        out.push(`${indent}},`);
      } else {
        const gap = n > 1 ? ' '.repeat(width - widths[j] + 1) : ' ';
        out.push(`${indent}${pair.key}:${gap}${pair.value}`);
      }
    }
    i = end;
  }
}

/** Element of one top-level entry field. Id lists become `[]int`, non-empty maps span several lines. */
function fieldPair(key: string, value: ExportValue, ctx: Context): Pair {
  const goKey = goString(key);
  if (Array.isArray(value) && ID_LIST_FIELDS.has(key)) {
    return { key: goKey, value: `[]int{${value.map((item) => inline(item, ctx)).join(', ')}},` };
  }
  if (isExportMap(value) && value.map.length > 0) {
    const inner = value.map.map(([innerKey, innerValue]) => ({
      key: goString(innerKey),
      value: `${inline(innerValue, ctx)},`,
    }));
    return { key: goKey, inner };
  }
  return { key: goKey, value: `${inline(value, ctx)},` };
}

function writeEntry(out: string[], entry: ExportEntry, ctx: Context): void {
  const comment = entry.comment.split('\0').join(' ').replace(COMMENT_UNSAFE, ' ').trimEnd();
  out.push(comment === '' ? '\t//' : `\t// ${comment}`, `\t${entry.id}: {`);
  writePairs(
    out,
    entry.fields.map(([key, value]) => fieldPair(key, value, ctx)),
    2,
  );
  out.push('\t},');
}

/**
 * Renders the export model as a Go source file (Go 1.18+, gofmt formatted) with
 * `<Prefix>RootID`, `<Prefix>Nodes` and `<Prefix>GetNode(id)`. The prefix keeps several trees
 * apart in one package. Every node is a `map[string]any`; id lists are `[]int`.
 *
 * Lines go straight into one array that is joined once, so memory stays proportional to the
 * output and large trees never hit argument-count limits.
 */
export function toGo(model: ExportModel, options: GoOptions): string {
  const ctx: Context = { usesMath: false };
  const prefix = options.namePrefix;
  const out: string[] = [
    `// Code generated by owl-bt from ${options.sourcePath}. DO NOT EDIT.`,
    '',
    `package ${options.packageName}`,
    '',
    // Slot 4 gets the `import "math"` prefix once the entries are written.
    `// ${prefix}RootID is the id of the root node.`,
    `const ${prefix}RootID = ${model.rootId}`,
    '',
    `// ${prefix}Nodes holds every node, decorator and service by id.`,
    `var ${prefix}Nodes = map[int]map[string]any{`,
  ];
  for (const entry of model.entries) {
    writeEntry(out, entry, ctx);
  }
  if (ctx.usesMath) {
    out[4] = `import "math"\n\n${out[4]}`;
  }
  out.push(
    '}',
    '',
    `// ${prefix}GetNode returns the item with the given id, or nil when there is none.`,
    `func ${prefix}GetNode(id int) map[string]any {`,
    `\treturn ${prefix}Nodes[id]`,
    '}',
    '',
  );
  return out.join('\n');
}
