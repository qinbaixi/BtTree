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

/** Byte length of the UTF-8 encoding; gofmt measures key sizes in bytes. */
function utf8Length(text: string): number {
  let length = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    length += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return length;
}

/** Tracks whether the generated code needs `import "math"` (NaN and infinities). */
interface Context {
  usesMath: boolean;
}

function tabs(depth: number): string {
  return '\t'.repeat(depth);
}

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

/** One `key: value` element of a composite literal; `value` is multi-line when `lines` is set. */
interface Pair {
  key: string;
  value: string;
  /** Continuation lines of a multi-line value (the first line is `value`). */
  lines?: string[];
}

/**
 * Lines of the key/value elements of a composite literal, aligned the way gofmt aligns them:
 * consecutive single-line elements share a value column; multi-line elements break the run, and
 * keys longer than 40 bytes start a new run when they are far from the average key size of the
 * current run.
 */
function pairLines(pairs: Pair[], depth: number): string[] {
  const sizes = pairs.map((pair) => (pair.lines === undefined ? utf8Length(pair.key) : 0));
  // Split into runs of aligned elements (gofmt's exprList heuristic).
  const runs: number[][] = [];
  let lnsum = 0;
  let count = 0;
  pairs.forEach((_, i) => {
    const size = sizes[i];
    const prevSize = i > 0 ? sizes[i - 1] : 0;
    let breakRun = true;
    if (prevSize > 0 && size > 0) {
      if (count === 0 || (prevSize <= 40 && size <= 40)) {
        breakRun = false;
      } else {
        const ratio = size / Math.exp(lnsum / count);
        breakRun = 2.5 * ratio <= 1 || 2.5 <= ratio;
      }
    }
    if (breakRun || runs.length === 0) {
      // A new section restarts the average.
      runs.push([i]);
      lnsum = 0;
      count = 0;
    } else {
      runs[runs.length - 1].push(i);
    }
    if (size > 0) {
      lnsum += Math.log(size);
      count++;
    }
  });

  const lines: string[] = [];
  for (const run of runs) {
    const width = Math.max(...run.map((i) => [...pairs[i].key].length));
    for (const i of run) {
      const pair = pairs[i];
      const aligned = pair.lines === undefined && pairs.length > 1;
      const gap = aligned ? ' '.repeat(width - [...pair.key].length + 1) : ' ';
      lines.push(`${tabs(depth)}${pair.key}:${gap}${pair.value}`);
      if (pair.lines !== undefined) {
        lines.push(...pair.lines);
      }
    }
  }
  return lines;
}

/** Element of one top-level entry field. Id lists become `[]int`, non-empty maps span several lines. */
function fieldPair(key: string, value: ExportValue, depth: number, ctx: Context): Pair {
  const goKey = goString(key);
  if (Array.isArray(value) && ID_LIST_FIELDS.has(key)) {
    return { key: goKey, value: `[]int{${value.map((item) => inline(item, ctx)).join(', ')}},` };
  }
  if (isExportMap(value) && value.map.length > 0) {
    const inner = value.map.map(([innerKey, innerValue]) => ({
      key: goString(innerKey),
      value: `${inline(innerValue, ctx)},`,
    }));
    return {
      key: goKey,
      value: 'map[string]any{',
      lines: [...pairLines(inner, depth + 1), `${tabs(depth)}},`],
    };
  }
  return { key: goKey, value: `${inline(value, ctx)},` };
}

function entryLines(entry: ExportEntry, ctx: Context): string[] {
  const comment = entry.comment.split('\0').join(' ').replace(COMMENT_UNSAFE, ' ').trimEnd();
  const pairs = entry.fields.map(([key, value]) => fieldPair(key, value, 2, ctx));
  return [`\t// ${comment}`.trimEnd(), `\t${entry.id}: {`, ...pairLines(pairs, 2), '\t},'];
}

/**
 * Renders the export model as a Go source file (Go 1.18+, gofmt formatted) with
 * `<Prefix>RootID`, `<Prefix>Nodes` and `<Prefix>GetNode(id)`. The prefix keeps several trees
 * apart in one package. Every node is a `map[string]any`; id lists are `[]int`.
 */
export function toGo(model: ExportModel, options: GoOptions): string {
  const ctx: Context = { usesMath: false };
  const body: string[] = [];
  for (const entry of model.entries) {
    body.push(...entryLines(entry, ctx));
  }

  const prefix = options.namePrefix;
  const lines: string[] = [
    `// Code generated by owl-bt from ${options.sourcePath}. DO NOT EDIT.`,
    '',
    `package ${options.packageName}`,
    '',
  ];
  if (ctx.usesMath) {
    lines.push('import "math"', '');
  }
  lines.push(
    `// ${prefix}RootID is the id of the root node.`,
    `const ${prefix}RootID = ${model.rootId}`,
    '',
    `// ${prefix}Nodes holds every node, decorator and service by id.`,
    `var ${prefix}Nodes = map[int]map[string]any{`,
    ...body,
    '}',
    '',
    `// ${prefix}GetNode returns the item with the given id, or nil when there is none.`,
    `func ${prefix}GetNode(id int) map[string]any {`,
    `\treturn ${prefix}Nodes[id]`,
    '}',
    '',
  );
  return lines.join('\n');
}
