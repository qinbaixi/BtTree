import {
  describeItem,
  findNode,
  getItemType,
  numberTree,
  type CompiledProject,
  type LogEntry,
  type LogKind,
  type Selection,
  type TickResult,
  type TreeNode,
} from '@owlbt/shared';

export type ValueType = 'number' | 'string' | 'boolean' | 'null';

export const VALUE_TYPES: readonly ValueType[] = ['number', 'string', 'boolean', 'null'];

export const LOG_KINDS: readonly LogKind[] = [
  'enter',
  'result',
  'decorator',
  'service',
  'blackboard',
  'error',
  'pass',
];

/** Editor type of a blackboard value. Objects and arrays are shown as strings (JSON). */
export function inferValueType(value: unknown): ValueType {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (value === null || value === undefined) return 'null';
  return 'string';
}

/** Converts a value to another editor type, keeping what can be kept. */
export function convertValue(value: unknown, type: ValueType): unknown {
  switch (type) {
    case 'number': {
      const num = typeof value === 'string' ? Number(value) : Number(value ?? 0);
      return Number.isFinite(num) ? num : 0;
    }
    case 'boolean':
      return typeof value === 'string' ? value === 'true' : Boolean(value);
    case 'null':
      return null;
    case 'string':
      if (value === null || value === undefined) return '';
      return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
}

/** "Label (Type)" or the type name when the node has no label. */
export function nodeDisplayName(root: TreeNode | undefined, nodeId: string): string {
  const node = root ? findNode(root, nodeId) : undefined;
  if (!node) return nodeId;
  return node.label ? `${node.label} (${node.type})` : node.type;
}

/** Name of the decorator / service of a log entry, falling back to the node name. */
export function entryDisplayName(root: TreeNode | undefined, entry: LogEntry): string {
  const node = root ? findNode(root, entry.nodeId) : undefined;
  if (!node) return entry.nodeId;
  if (entry.itemId) {
    const item = [...node.decorators, ...node.services].find((i) => i.id === entry.itemId);
    if (item) return `${nodeDisplayName(root, node.id)} / ${item.label ?? item.type}`;
  }
  return nodeDisplayName(root, node.id);
}

/** What a click on a log row selects: the decorator / service, or the node. */
export function selectionForEntry(
  root: TreeNode | undefined,
  entry: LogEntry,
): Selection | undefined {
  const node = root ? findNode(root, entry.nodeId) : undefined;
  if (!node) return undefined;
  if (entry.itemId) {
    if (node.decorators.some((d) => d.id === entry.itemId)) {
      return { kind: 'decorator', nodeId: node.id, itemId: entry.itemId };
    }
    if (node.services.some((s) => s.id === entry.itemId)) {
      return { kind: 'service', nodeId: node.id, itemId: entry.itemId };
    }
  }
  return { kind: 'node', nodeId: node.id };
}

/** Log entries of history[0..viewIndex] whose kind is enabled, oldest first. */
export function collectLog(
  history: TickResult[],
  viewIndex: number,
  kinds: ReadonlySet<LogKind>,
): LogEntry[] {
  const out: LogEntry[] = [];
  for (let i = 0; i <= viewIndex && i < history.length; i++) {
    for (const entry of history[i].log) {
      if (kinds.has(entry.kind)) {
        out.push(entry);
      }
    }
  }
  return out;
}

export type RunStatusLabel =
  'Ready' | 'Running' | 'Success' | 'Failure' | 'Waiting for manual result';

/** Status text of the toolbar for a viewed tick. */
export function statusLabel(viewed: TickResult | undefined): RunStatusLabel {
  if (!viewed || viewed.tick === 0) return 'Ready';
  if (viewed.finished === 'success') return 'Success';
  if (viewed.finished === 'failure') return 'Failure';
  if (viewed.pendingManual) return 'Waiting for manual result';
  return 'Running';
}

/** "Run 2/5" / "Run 3/∞"; undefined when the tree runs only once. */
export function passLabel(tick: TickResult | undefined): string | undefined {
  if (!tick || tick.passes === 1) return undefined;
  return `Run ${tick.pass}/${tick.passes === 0 ? '∞' : tick.passes}`;
}

/** "Finished after 5 runs: Success"; undefined unless a looped run has finished. */
export function finishedLabel(tick: TickResult | undefined): string | undefined {
  if (!tick?.finished || tick.passes === 1) return undefined;
  const result = tick.finished === 'success' ? 'Success' : 'Failure';
  return `Finished after ${tick.pass} ${tick.pass === 1 ? 'run' : 'runs'}: ${result}`;
}

/** Parses the text of a blackboard value input for the given type. Undefined = ignore the input. */
export function parseValueInput(raw: string, type: ValueType): unknown {
  if (type === 'number') {
    if (raw.trim() === '' || raw === '-') return undefined;
    const num = Number(raw);
    return Number.isFinite(num) ? num : undefined;
  }
  return raw;
}

// ----- log layout -----

export const LOG_HEIGHT_STORAGE_KEY = 'owlbt.runLogHeight';
export const LOG_MIN_HEIGHT = 120;
export const LOG_DEFAULT_HEIGHT = 240;
export const LOG_MAX_RATIO = 0.7;

/** Height of the log panel limited to [120px, 70% of the editor area]. */
export function clampLogHeight(height: number, areaHeight: number): number {
  if (!Number.isFinite(height)) return LOG_DEFAULT_HEIGHT;
  const max = Math.max(LOG_MIN_HEIGHT, Math.floor(areaHeight * LOG_MAX_RATIO));
  return Math.round(Math.min(max, Math.max(LOG_MIN_HEIGHT, height)));
}

// ----- tick summary -----

export interface BlackboardChange {
  key: string;
  from: string;
  to: string;
}

export interface TickSummary {
  /** Deepest running nodes at the end of the tick (the leaves where execution is). */
  activeNodes: string[];
  /** Set when the root finished in this tick. */
  finished?: 'success' | 'failure';
  /** One change per key: first old value to last new value of the tick. */
  bbChanges: BlackboardChange[];
  errors: number;
  decoratorFails: number;
  /** Node waiting for a manual result. */
  manualPending?: string;
  /** Result of the run (pass) that ended in this tick (looped runs only). */
  passResult?: 'success' | 'failure';
}

/** Splits an engine message "key: old → new". Undefined when it has another shape. */
export function parseBlackboardMessage(message: string): BlackboardChange | undefined {
  const colon = message.indexOf(': ');
  const arrow = message.lastIndexOf(' → ');
  if (colon < 0 || arrow < colon + 2) return undefined;
  return {
    key: message.slice(0, colon),
    from: message.slice(colon + 2, arrow),
    to: message.slice(arrow + 3),
  };
}

/** True for decorator entries reporting a failed check (condition fail, abort, time limit). */
export function isDecoratorFail(message: string): boolean {
  return /→ fail$|aborting|time limit/.test(message);
}

/** Running nodes without a running child, in tree order. */
function activeLeaves(node: TreeNode, tick: TickResult, out: string[]): boolean {
  let childRunning = false;
  for (const child of node.childNodes) {
    if (activeLeaves(child, tick, out)) childRunning = true;
  }
  const running = tick.statuses[node.id] === 'running';
  if (running && !childRunning) out.push(node.id);
  return running || childRunning;
}

/** Condenses a tick: where execution is, blackboard changes and problem counters. */
export function summarizeTick(tick: TickResult, root: TreeNode | undefined): TickSummary {
  const activeNodes: string[] = [];
  if (root) activeLeaves(root, tick, activeNodes);
  const changes = new Map<string, BlackboardChange>();
  let errors = 0;
  let decoratorFails = 0;
  for (const entry of tick.log) {
    if (entry.kind === 'error') {
      errors++;
    } else if (entry.kind === 'decorator' && isDecoratorFail(entry.message)) {
      decoratorFails++;
    } else if (entry.kind === 'blackboard') {
      const change = parseBlackboardMessage(entry.message);
      if (change) {
        const previous = changes.get(change.key);
        changes.set(change.key, previous ? { ...change, from: previous.from } : change);
      }
    }
  }
  const summary: TickSummary = {
    activeNodes,
    bbChanges: [...changes.values()],
    errors,
    decoratorFails,
  };
  if (tick.finished) summary.finished = tick.finished;
  if (tick.passResult) summary.passResult = tick.passResult;
  if (tick.pendingManual) summary.manualPending = tick.pendingManual;
  return summary;
}

/** Depth (root = 0) of every node, for indenting log lines like a call stack. */
export function buildDepthMap(root: TreeNode | undefined): Map<string, number> {
  const depths = new Map<string, number>();
  const visit = (node: TreeNode, depth: number): void => {
    depths.set(node.id, depth);
    for (const child of node.childNodes) visit(child, depth + 1);
  };
  if (root) visit(root, 0);
  return depths;
}

/** Depth of one node (path length - 1); 0 for unknown ids. */
export function nodeDepth(root: TreeNode | undefined, nodeId: string): number {
  return buildDepthMap(root).get(nodeId) ?? 0;
}

export type ResultTone = 'success' | 'failure' | 'neutral';

/** Tone of a result / decorator message for coloring. */
export function resultTone(message: string): ResultTone {
  if (/^success$|condition true|→ pass$/.test(message)) return 'success';
  if (/^failure$|condition false|→ fail$|aborting|time limit/.test(message)) return 'failure';
  return 'neutral';
}

/** Short name of the node of a log entry: its label, else its type; plus the type and sub item. */
export function entryParts(
  root: TreeNode | undefined,
  entry: LogEntry,
): { name: string; type?: string; item?: string } {
  const node = root ? findNode(root, entry.nodeId) : undefined;
  if (!node) return { name: entry.nodeId };
  const parts: { name: string; type?: string; item?: string } = { name: node.label || node.type };
  if (node.label) parts.type = node.type;
  if (entry.itemId) {
    const item = [...node.decorators, ...node.services].find((i) => i.id === entry.itemId);
    if (item) parts.item = item.label || item.type;
  }
  return parts;
}

// ----- export ids and descriptions -----

/**
 * Export number (`#N`, the node_id of the exports) of every node, decorator and service,
 * keyed by its runtime id. Build it once per tree version.
 */
export function buildExportIdMap(root: TreeNode | undefined): Map<string, number> {
  const ids = new Map<string, number>();
  if (root) {
    for (const numbered of numberTree(root)) ids.set(numbered.item.id, numbered.id);
  }
  return ids;
}

export type RunOverrides = Record<string, Record<string, unknown> | undefined>;

/** Description of a node / decorator / service with its run overrides applied. */
export function describeWithOverrides(
  project: CompiledProject | undefined,
  kind: 'node' | 'decorator' | 'service',
  type: string,
  id: string,
  properties: Record<string, unknown>,
  overrides: RunOverrides | undefined,
): string | undefined {
  if (!project) return undefined;
  const merged = { ...properties };
  const own = overrides?.[id];
  if (own) {
    for (const [name, value] of Object.entries(own)) {
      if (value !== undefined) merged[name] = value;
    }
  }
  const text = describeItem(getItemType(project, kind, type), merged)?.trim();
  return text || undefined;
}

export interface NodeInfo {
  /** Export number; undefined when the item is not in the numbered tree. */
  exportId?: number;
  /** Label, else the type name. */
  name: string;
  /** The type name, only when a label is shown as the name. */
  type?: string;
  description?: string;
}

/** Id, name and effective description of a node. */
export function nodeInfo(
  root: TreeNode | undefined,
  project: CompiledProject | undefined,
  ids: ReadonlyMap<string, number>,
  overrides: RunOverrides | undefined,
  nodeId: string,
): NodeInfo {
  const node = root ? findNode(root, nodeId) : undefined;
  if (!node) return { name: nodeId };
  const info: NodeInfo = { name: node.label || node.type };
  const exportId = ids.get(node.id);
  if (exportId !== undefined) info.exportId = exportId;
  if (node.label) info.type = node.type;
  const description = describeWithOverrides(
    project,
    'node',
    node.type,
    node.id,
    node.properties,
    overrides,
  );
  if (description) info.description = description;
  return info;
}

/** Id, name and effective description of the decorator / service of a log entry, else of its node. */
export function entryInfo(
  root: TreeNode | undefined,
  project: CompiledProject | undefined,
  ids: ReadonlyMap<string, number>,
  overrides: RunOverrides | undefined,
  entry: LogEntry,
): NodeInfo {
  const node = root ? findNode(root, entry.nodeId) : undefined;
  if (node && entry.itemId) {
    const decorator = node.decorators.find((i) => i.id === entry.itemId);
    const item = decorator ?? node.services.find((i) => i.id === entry.itemId);
    if (item) {
      const info: NodeInfo = { name: item.label || item.type };
      const exportId = ids.get(item.id);
      if (exportId !== undefined) info.exportId = exportId;
      if (item.label) info.type = item.type;
      const description = describeWithOverrides(
        project,
        decorator ? 'decorator' : 'service',
        item.type,
        item.id,
        item.properties,
        overrides,
      );
      if (description) info.description = description;
      return info;
    }
  }
  return nodeInfo(root, project, ids, overrides, entry.nodeId);
}
