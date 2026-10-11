/**
 * Performance and memory benchmark of the editor's hot paths.
 *
 *   npm run bench
 *
 * Prints a Markdown table: median time per operation and the bytes allocated per operation
 * (heap growth of one run; the script fails when a GC runs while measuring).
 * Only uses APIs that exist on older revisions too, so the same script can compare two commits.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GCProfiler } from 'node:v8';
import * as shared from '@owlbt/shared';
import {
  buildExportModel,
  createIdGen,
  findParent,
  forEachNode,
  getItemType,
  isTreeValid,
  nodeFromJson,
  toCSharp,
  toErlang,
  toLua,
  toTypeScript,
  validateItem,
  type CompiledItemType,
  type TreeNode,
} from '@owlbt/shared';
import { exportProject } from '../../packages/server/src/export';
import {
  findTypeUsages,
  summarizeTree,
} from '../../packages/client/src/components/PropertyPanel/treeInspect';
import { buildTreeJson, createRandom, project, projectText, PROJECT_PATH } from './fixture';

const gc = (globalThis as { gc?: () => void }).gc;
if (!gc) {
  throw new Error('Run with --expose-gc');
}

/** `isItemValid` when the revision has it (what the canvas uses), else `validateItem().isValid`. */
const itemValid: (type: CompiledItemType, properties: Record<string, unknown>) => boolean =
  (shared as { isItemValid?: typeof itemValid }).isItemValid ??
  ((type, properties) => validateItem(type, properties).isValid);

interface Result {
  name: string;
  medianMs: number;
  bytesPerOp?: number;
}

const results: Result[] = [];

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function bench(name: string, fn: () => unknown, runs = 30): void {
  for (let i = 0; i < 5; i++) fn();
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  // One run with a fresh heap; the young generation is large enough that it needs no GC.
  gc!();
  gc!();
  const profiler = new GCProfiler();
  profiler.start();
  const before = process.memoryUsage().heapUsed;
  const kept = fn();
  const after = process.memoryUsage().heapUsed;
  const gcRuns = profiler.stop()?.statistics.length ?? 0;
  if (gcRuns > 0) {
    throw new Error(`${name}: a GC ran while measuring allocations, use a larger young generation`);
  }
  void kept;
  results.push({ name, medianMs: median(times), bytesPerOp: after - before });
}

async function benchAsync(name: string, fn: () => Promise<unknown>, runs = 7): Promise<void> {
  await fn();
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }
  results.push({ name, medianMs: median(times) });
}

// ---------- In-memory tree operations ----------

const SIZE = Number(process.env.BENCH_TREE_SIZE ?? 5000);
const root: TreeNode = nodeFromJson(buildTreeJson(SIZE), createIdGen('n'));
const allNodes: TreeNode[] = [];
forEachNode(root, (node) => allNodes.push(node));
const random = createRandom(7);
const lookups = Array.from(
  { length: 200 },
  () => allNodes[Math.floor(random() * allNodes.length)].id,
);
let items = 0;
let maxDepth = 0;
{
  const depthOf = (node: TreeNode, depth: number): void => {
    items += 1 + node.decorators.length + node.services.length;
    maxDepth = Math.max(maxDepth, depth);
    node.childNodes.forEach((child) => depthOf(child, depth + 1));
  };
  depthOf(root, 1);
}

bench(`isTreeValid (save check), ${allNodes.length} nodes`, () => isTreeValid(root, project));

bench(`validate every item (canvas render), ${items} items`, () => {
  let invalid = 0;
  for (const node of allNodes) {
    if (!itemValid(getItemType(project, 'node', node.type), node.properties)) invalid++;
    for (const d of node.decorators) {
      if (!itemValid(getItemType(project, 'decorator', d.type), d.properties)) invalid++;
    }
    for (const s of node.services) {
      if (!itemValid(getItemType(project, 'service', s.type), s.properties)) invalid++;
    }
  }
  return invalid;
});

bench('findParent x200 (navigation, move, delete)', () => {
  let found = 0;
  for (const id of lookups) if (findParent(root, id)) found++;
  return found;
});

bench('summarizeTree (tree overview panel)', () => summarizeTree(root, project));

bench('findTypeUsages (type details panel)', () => findTypeUsages(root, 'decorator', 'Loop'));

bench('buildExportModel', () => buildExportModel(root, project));

const model = buildExportModel(root, project);
bench('toErlang', () => toErlang(model, { module: 'bench', sourcePath: 'bench.json' }), 10);
bench('toLua', () => toLua(model, { sourcePath: 'bench.json' }), 10);
bench('toTypeScript', () => toTypeScript(model, { sourcePath: 'bench.json' }), 10);
bench(
  'toCSharp',
  () => toCSharp(model, { sourcePath: 'bench.json', className: 'Bench', namespace: 'Bench' }),
  10,
);

// ---------- Batch export (file system) ----------

const TREES = Number(process.env.BENCH_EXPORT_TREES ?? 40);
const dir = await mkdtemp(join(tmpdir(), 'owlbt-bench-'));
try {
  await writeFile(join(dir, 'owl-bt.json'), projectText);
  // A project plugin next to owl-bt.json (untrusted, like a freshly cloned project).
  await writeFile(join(dir, 'owl-bt.js'), 'module.exports = { onTreeSave() { return true; } };\n');
  process.env.OWLBT_TRUST_FILE = join(dir, 'trusted-plugins.json');
  await mkdir(join(dir, 'trees'));
  for (let i = 0; i < TREES; i++) {
    const json = buildTreeJson(300, i + 1);
    await writeFile(join(dir, 'trees', `tree${i}.json`), JSON.stringify(json, null, '\t'));
  }
  await benchAsync(`exportProject: ${TREES} trees x 300 nodes, 4 formats`, () =>
    exportProject(dir, ['erlang', 'lua', 'ts', 'cs'], { outDir: join(dir, 'out') }),
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}

// ---------- Report ----------

const kb = (bytes: number | undefined): string =>
  bytes === undefined ? '-' : `${Math.max(0, bytes / 1024).toFixed(0)} KB`;

console.log(
  `Tree: ${allNodes.length} nodes, ${items} items, depth ${maxDepth}. Project: ${PROJECT_PATH}\n`,
);
console.log('| Benchmark | Median time | Allocated per op |');
console.log('| --- | ---: | ---: |');
for (const result of results) {
  console.log(`| ${result.name} | ${result.medianMs.toFixed(3)} ms | ${kb(result.bytesPerOp)} |`);
}
