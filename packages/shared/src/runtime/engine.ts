import { getItemType } from '../compileProject';
import { expandSubtrees, isSubtreeType, type SubtreeLibrary } from '../subtree';
import { setOwnProperty } from '../treeModel';
import { findNode, forEachNode } from '../treeOps';
import { getEffectiveValue } from '../validation';
import {
  evaluate,
  ExprError,
  isTruthy,
  parseAssignment,
  parseExpression,
  type Assignment,
  type Expr,
} from './expr';
import type {
  CompiledItemType,
  CompiledProject,
  CompiledProperty,
  SimulateComposite,
  SimulateJson,
  SimulateMode,
  SubItem,
  TreeNode,
} from '../types';

/*
 * Behavior tree simulator (run mode). Pure and deterministic: no timers, no I/O, no Math.random.
 * One tick = one second. The whole tree is ticked from the root every tick; RUNNING nodes resume.
 */

export type RunStatus = 'idle' | 'running' | 'success' | 'failure';
export type SubStatus = 'pass' | 'fail' | 'ran';
export type LogKind =
  'enter' | 'result' | 'blackboard' | 'service' | 'error' | 'decorator' | 'pass' | 'score';
export type ManualResult = 'success' | 'failure';
type Outcome = ManualResult | 'running';

export interface LogEntry {
  /** Tick the entry belongs to. */
  tick: number;
  nodeId: string;
  /** Decorator / service id when the entry is about a sub item. */
  itemId?: string;
  message: string;
  kind: LogKind;
}

export interface TickResult {
  /** Number of the last executed tick (0 before the first tick). */
  tick: number;
  statuses: Record<string, RunStatus>;
  subStatuses: Record<string, SubStatus>;
  /**
   * Utility scores of the children of utility composites, by child node id, as computed when the
   * composite started. Only set when at least one score is known.
   */
  scores?: Record<string, number>;
  blackboard: Record<string, unknown>;
  /** Entries produced by this tick. */
  log: LogEntry[];
  /** Set once the root node has finished (in the last pass). */
  finished?: ManualResult;
  /** 1-based number of the current pass (run of the tree). */
  pass: number;
  /** Configured number of passes; 0 = endless. */
  passes: number;
  /** Result of the pass that ended in this tick (only when the run loops). */
  passResult?: ManualResult;
  /** First node waiting for resolveManual(). */
  pendingManual?: string;
}

export interface RunOptions {
  /** Initial blackboard values. */
  blackboard: Record<string, unknown>;
  /** Seed of the pseudo random generator (RandomSelector, weighted random utility). Default 1. */
  seed?: number;
  /** Property overrides by node / decorator / service id. */
  overrides?: Record<string, Record<string, unknown>>;
  /** Number of times the tree runs (integer >= 0; default 1; 0 = endless). */
  loops?: number;
  /**
   * Trees referenced by subtree nodes (loaded before the run starts). Each subtree node runs its
   * referenced tree as its only child, sharing the blackboard. Missing trees, cycles and too deep
   * nesting make the subtree node fail with an error in the log.
   */
  subtrees?: SubtreeLibrary;
  /** Project-relative path of the tree itself, so a subtree referencing it is seen as a cycle. */
  treeRef?: string;
}

/** Normalizes a loops value: integer >= 0, anything else becomes 1. */
export function normalizeLoops(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 1;
  return Math.max(0, Math.floor(value));
}

export interface StepResult {
  /** Number of the last executed tick (0 before the first tick). */
  tick: number;
  /** Entries produced by this tick. */
  log: LogEntry[];
  /** Set once the root node has finished (in the last pass). */
  finished?: ManualResult;
  /** First node waiting for resolveManual(). */
  pendingManual?: string;
}

export interface Run {
  /**
   * The tree that runs: the given tree with the referenced trees of subtree nodes attached as their
   * children (ids `<subtree node id>/<n>`). The given tree itself when it has no subtree nodes.
   */
  readonly root: TreeNode;
  /** Executes one tick. Does nothing (returns the current state) while finished or waiting for a manual result. */
  tick(): TickResult;
  /** Lightweight tick that skips cloning statuses and blackboard; use snapshot() when full state is needed. */
  step(): StepResult;
  /** Resolves a pending manual action; the node finishes in the next tick. */
  resolveManual(nodeId: string, result: ManualResult): void;
  /** First node waiting for a manual result. */
  pendingManual(): string | undefined;
  /** Current state; `log` holds the entries of the last tick. */
  snapshot(): TickResult;
  /** Sets a blackboard value immediately (not logged). */
  setBlackboardValue(key: string, value: unknown): void;
  removeBlackboardKey(key: string): void;
  /**
   * Changes the number of passes (0 = endless). A value below the current pass makes the
   * current pass the last one. Ignored once the run has finished.
   */
  setLoops(loops: number): void;
  /** Captures the complete run state (used to step back). */
  checkpoint(): RunCheckpoint;
  /** Returns the run to a state captured by checkpoint() of the same run. */
  restore(checkpoint: RunCheckpoint): void;
}

/** Opaque copy of the internal state of a run. */
export interface RunCheckpoint {
  readonly __runCheckpoint: true;
}

interface CheckpointData {
  blackboard: Record<string, unknown>;
  statuses: Record<string, RunStatus>;
  subStatuses: Record<string, SubStatus>;
  scores: Record<string, number>;
  states: Array<[string, NodeState]>;
  cooldownStart: Array<[string, number]>;
  resolutions: Array<[string, ManualResult]>;
  pending: string[];
  finished: ManualResult | undefined;
  tickNo: number;
  loops: number;
  pass: number;
  passResult: ManualResult | undefined;
  log: LogEntry[];
  random: number;
}

// ---------- helpers shared with the UI ----------

const COMPOSITE_BY_NAME: ReadonlyMap<string, SimulateComposite> = new Map([
  ['selector', 'selector'],
  ['sequence', 'sequence'],
  ['parallel', 'parallel'],
  ['randomselector', 'randomSelector'],
  ['utilityselector', 'utility'],
]);

/** Composite kind of a node type: simulate.composite, else the (ancestor) type name, else sequence. */
export function resolveCompositeKind(type: CompiledItemType): SimulateComposite {
  if (type.simulate?.composite) {
    return type.simulate.composite;
  }
  const chain = type.ancestors ?? type.bases ?? [];
  for (const name of [type.name, ...chain]) {
    const found = COMPOSITE_BY_NAME.get(name.toLowerCase());
    if (found) {
      return found;
    }
  }
  return 'sequence';
}

/** True for composite node types that run as utility composites. */
export function isUtilityComposite(type: CompiledItemType): boolean {
  return type.isComposite && !type.isInvalid && resolveCompositeKind(type) === 'utility';
}

/** True for decorator types that give a utility score (`simulate.score`). */
export function isScoreDecorator(type: CompiledItemType): boolean {
  return type.simulate?.score !== undefined;
}

/** Utility composite settings (properties of the composite node, by convention like `Policy`). */
export type UtilityFailurePolicy = 'trynext' | 'fail';
export type UtilitySelection = 'highest' | 'weightedrandom';

/**
 * Combines the scores of the score decorators of one child: the product of all scores. With more
 * than one score, factors in 0..1 are compensated (Dave Mark's IAUS make-up value) so that a child
 * with many considerations is not punished only for having many: s + (1 - s) * (1 - 1/n) * s.
 * Factors outside 0..1 (weights) are multiplied as they are. Any non-positive or non-finite factor
 * disqualifies the child (returns 0). No scores = 0.
 */
export function combineScores(scores: readonly number[]): number {
  if (scores.length === 0) return 0;
  const n = scores.length;
  const modification = 1 - 1 / n;
  let total = 1;
  for (const s of scores) {
    if (!Number.isFinite(s) || s <= 0) {
      return 0;
    }
    const factor = n > 1 && s <= 1 ? s + (1 - s) * modification * s : s;
    total *= factor;
  }
  return Number.isFinite(total) ? total : Number.MAX_VALUE;
}

/** Effective action mode: explicit mode, else 'rule' when condition / duration / effects exist, else 'manual'. */
export function resolveActionMode(sim: SimulateJson | undefined): SimulateMode {
  if (sim?.mode) {
    return sim.mode;
  }
  if (sim && (sim.condition !== undefined || sim.duration !== undefined || sim.effects?.length)) {
    return 'rule';
  }
  return 'manual';
}

export function formatValue(value: unknown): string {
  if (value === undefined) return '(unset)';
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
  if (typeof value === 'string') return JSON.stringify(value);
  return JSON.stringify(value) ?? String(value);
}

/** Seeded PRNG (mulberry32) returning numbers in [0, 1). */
interface Random {
  next(): number;
  /** Internal state; restoring it repeats the same sequence. */
  state: number;
}

function createRandom(seed: number): Random {
  return {
    state: seed >>> 0,
    next() {
      this.state = (this.state + 0x6d2b79f5) >>> 0;
      let t = this.state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => valuesEqual(item, b[i]));
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keys = Object.keys(ra);
  return (
    keys.length === Object.keys(rb).length &&
    keys.every((key) => Object.hasOwn(rb, key) && valuesEqual(ra[key], rb[key]))
  );
}

function deepClone<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(deepClone) as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      setOwnProperty(out, key, deepClone(inner));
    }
    return out as T;
  }
  return value;
}

const PROP_MAPS = new WeakMap<CompiledItemType, Map<string, CompiledProperty>>();

function propOf(type: CompiledItemType, name: string): CompiledProperty | undefined {
  let map = PROP_MAPS.get(type);
  if (!map) {
    map = new Map(type.properties.map((p) => [p.name, p]));
    PROP_MAPS.set(type, map);
  }
  return map.get(name);
}

// ---------- engine ----------

interface BodyState {
  elapsed: number;
  duration?: number;
  manual?: boolean;
  childResults?: Array<Outcome | undefined>;
}

interface TimeLimitEntry {
  index: number;
  id: string;
  type: string;
  limit: number;
}

interface NodeState {
  startTick: number;
  index: number;
  order?: number[];
  body: BodyState;
  loopDone: number;
  /** Subtree nodes: entering the referenced tree was logged. */
  entered?: boolean;
  /** The body restarts at the start of the next tick (loop decorator). */
  restart?: boolean;
  loopTotal: number;
  /** Index of the innermost / outermost loop decorator (undefined when the node has no loop). */
  loopIndex?: number;
  outerLoopIndex?: number;
  timeLimits?: TimeLimitEntry[];
}

export function createRun(tree: TreeNode, project: CompiledProject, options: RunOptions): Run {
  const expansion = expandSubtrees(tree, project, options.subtrees ?? {}, {
    mode: 'child',
    selfRef: options.treeRef,
  });
  const root = expansion.root;
  const rawBlackboard = options.blackboard;
  const blackboard: Record<string, unknown> =
    typeof rawBlackboard === 'object' && rawBlackboard !== null && !Array.isArray(rawBlackboard)
      ? deepClone(rawBlackboard)
      : {};
  const overrides = options.overrides ?? {};
  const random = createRandom(options.seed ?? 1);

  const statuses: Record<string, RunStatus> = {};
  const subStatuses: Record<string, SubStatus> = {};
  const scores: Record<string, number> = {};
  let scoreCount = 0;
  let ranServices: string[] = [];
  const states = new Map<string, NodeState>();
  const cooldownStart = new Map<string, number>();
  const resolutions = new Map<string, ManualResult>();
  const pending = new Set<string>();
  let finished: ManualResult | undefined;
  let tickNo = 0;
  let loops = normalizeLoops(options.loops);
  let pass = 1;
  /** Result of the pass that ended in the last tick. */
  let passResult: ManualResult | undefined;
  let log: LogEntry[] = [];

  const exprCache = new Map<string, Expr>();
  const assignCache = new Map<string, Assignment>();

  forEachNode(root, (node) => {
    statuses[node.id] = 'idle';
  });

  const firstPending = (): string | undefined => pending.values().next().value;

  const setScore = (nodeId: string, value: number): void => {
    if (!Object.hasOwn(scores, nodeId)) {
      scoreCount++;
    }
    scores[nodeId] = value;
  };

  const deleteScore = (nodeId: string): void => {
    if (Object.hasOwn(scores, nodeId)) {
      delete scores[nodeId];
      scoreCount--;
    }
  };

  // ----- logging -----

  const add = (kind: LogKind, nodeId: string, message: string, itemId?: string): void => {
    const entry: LogEntry = { tick: tickNo, nodeId, message, kind };
    if (itemId !== undefined) entry.itemId = itemId;
    log.push(entry);
  };

  // ----- expressions -----

  const propValue = (
    type: CompiledItemType,
    owner: { id: string; properties: Record<string, unknown> },
    name: string,
  ): unknown => {
    const own = Object.hasOwn(overrides, owner.id) ? overrides[owner.id] : undefined;
    if (own && Object.hasOwn(own, name) && own[name] !== undefined) {
      return own[name];
    }
    const prop = propOf(type, name);
    if (prop) {
      return getEffectiveValue(prop, owner.properties);
    }
    return Object.hasOwn(owner.properties, name) ? owner.properties[name] : undefined;
  };

  const ctxFor = (type: CompiledItemType, owner: TreeNode | SubItem) => ({
    get: (key: string) => (Object.hasOwn(blackboard, key) ? blackboard[key] : null),
    prop: (name: string) => propValue(type, owner, name),
  });

  const parseCached = (src: string): Expr => {
    let expr = exprCache.get(src);
    if (!expr) {
      expr = parseExpression(src);
      exprCache.set(src, expr);
    }
    return expr;
  };

  const evalText = (src: string, type: CompiledItemType, owner: TreeNode | SubItem): unknown =>
    evaluate(parseCached(src), ctxFor(type, owner));

  /** Number / template to a number. Throws ExprError for non numeric results. */
  const evalNumber = (
    value: number | string | undefined,
    fallback: number,
    type: CompiledItemType,
    owner: TreeNode | SubItem,
    what: string,
  ): number => {
    if (value === undefined) return fallback;
    const result = typeof value === 'number' ? value : evalText(value, type, owner);
    const num = typeof result === 'string' && result.trim() !== '' ? Number(result) : result;
    if (typeof num !== 'number' || !Number.isFinite(num)) {
      throw new ExprError(`${what} must be a number, got ${formatValue(result)}`, 0);
    }
    return num;
  };

  const setBlackboard = (key: string, value: unknown, nodeId: string, itemId?: string): void => {
    const had = Object.hasOwn(blackboard, key);
    const old = had ? blackboard[key] : undefined;
    setOwnProperty(blackboard, key, value);
    if (!had || !valuesEqual(old, value)) {
      add('blackboard', nodeId, `${key}: ${formatValue(old)} → ${formatValue(value)}`, itemId);
    }
  };

  const runEffects = (
    effects: string[] | undefined,
    type: CompiledItemType,
    owner: TreeNode | SubItem,
    nodeId: string,
    itemId?: string,
  ): void => {
    if (!effects || effects.length === 0) return;
    const ctx = ctxFor(type, owner);
    for (const src of effects) {
      let assignment = assignCache.get(src);
      if (!assignment) {
        assignment = parseAssignment(src);
        assignCache.set(src, assignment);
      }
      const value = evaluate(assignment.expr, ctx);
      setBlackboard(assignment.target, value, nodeId, itemId);
    }
  };

  // ----- bookkeeping -----

  const dropManual = (id: string): void => {
    pending.delete(id);
    resolutions.delete(id);
  };

  const clearSubStatuses = (node: TreeNode): void => {
    for (const item of node.decorators) {
      delete subStatuses[item.id];
    }
    for (const item of node.services) {
      delete subStatuses[item.id];
    }
  };

  /** Resets all descendants to idle (used when a node (re)starts). */
  const resetChildren = (node: TreeNode): void => {
    for (const child of node.childNodes) {
      states.delete(child.id);
      statuses[child.id] = 'idle';
      deleteScore(child.id);
      clearSubStatuses(child);
      dropManual(child.id);
      resetChildren(child);
    }
  };

  /** Stops every running node of the subtree. */
  const abortSubtree = (node: TreeNode): void => {
    abortChildren(node);
    if (states.has(node.id)) {
      states.delete(node.id);
      statuses[node.id] = 'idle';
      clearSubStatuses(node);
      for (const child of node.childNodes) {
        deleteScore(child.id);
      }
      dropManual(node.id);
      add('result', node.id, 'aborted');
    }
  };

  /** Stops the running descendants of a node (the node itself keeps its state). */
  function abortChildren(node: TreeNode): void {
    for (const child of node.childNodes) {
      abortSubtree(child);
    }
  }

  const nodeType = (node: TreeNode): CompiledItemType => getItemType(project, 'node', node.type);

  const finishNode = (node: TreeNode, result: ManualResult): ManualResult => {
    states.delete(node.id);
    statuses[node.id] = result;
    dropManual(node.id);
    add('result', node.id, result);
    for (const decorator of node.decorators) {
      if (getItemType(project, 'decorator', decorator.type).simulate?.decorator === 'cooldown') {
        cooldownStart.set(decorator.id, tickNo);
      }
    }
    return result;
  };

  const failWithError = (node: TreeNode, error: unknown, itemId?: string): ManualResult => {
    abortChildren(node);
    add('error', node.id, error instanceof Error ? error.message : String(error), itemId);
    return finishNode(node, 'failure');
  };

  // ----- decorators -----

  /** Condition of a decorator: true = pass. Decorators without condition pass. */
  const decoratorPasses = (
    node: TreeNode,
    decorator: SubItem,
    type: CompiledItemType,
    quiet: boolean,
  ): boolean => {
    const condition = type.simulate?.condition;
    if (condition === undefined) {
      return true;
    }
    const value = isTruthy(evalText(condition, type, decorator));
    const pass = decorator.inverseCheckCondition ? !value : value;
    if (!pass || !quiet) {
      add(
        'decorator',
        node.id,
        `${decorator.type}: condition ${value ? 'true' : 'false'}${
          decorator.inverseCheckCondition ? ' (inverted)' : ''
        } → ${pass ? 'pass' : 'fail'}`,
        decorator.id,
      );
    }
    return pass;
  };

  // ----- execution -----

  const runServices = (node: TreeNode, state: NodeState): void => {
    for (const service of node.services) {
      const type = getItemType(project, 'service', service.type);
      const between = Math.max(1, Math.floor(service.timeBetweenTicks ?? 1));
      const first = Math.max(0, Math.floor(service.firstTickTime ?? 0));
      const rel = tickNo - state.startTick - first;
      if (rel < 0 || rel % between !== 0) {
        continue;
      }
      subStatuses[service.id] = 'ran';
      ranServices.push(service.id);
      add('service', node.id, `${service.type} ticked`, service.id);
      try {
        runEffects(type.simulate?.effects, type, service, node.id, service.id);
      } catch (e) {
        add('error', node.id, e instanceof Error ? e.message : String(e), service.id);
      }
    }
  };

  /** Score of one child: the combined score decorators; an error in one logs it and gives 0. */
  const scoreChild = (child: TreeNode): number => {
    const parts: number[] = [];
    for (const decorator of child.decorators) {
      const type = getItemType(project, 'decorator', decorator.type);
      const src = type.simulate?.score;
      if (src === undefined) continue;
      try {
        parts.push(evalNumber(src, 0, type, decorator, 'score'));
      } catch (e) {
        add('error', child.id, e instanceof Error ? e.message : String(e), decorator.id);
        return 0;
      }
    }
    return combineScores(parts);
  };

  /** Weighted random permutation of the given candidates (weights > 0). Rescales if sum overflows. */
  const weightedOrder = (pool: Array<{ i: number; w: number }>): number[] => {
    const rest = [...pool];
    const order: number[] = [];
    while (rest.length > 0) {
      let total = 0;
      let maxW = 0;
      for (const p of rest) {
        total += p.w;
        if (p.w > maxW) maxW = p.w;
      }
      const scale = !Number.isFinite(total) && maxW > 0 ? 1 / maxW : 1;
      if (scale !== 1) {
        total = 0;
        for (const p of rest) {
          total += p.w * scale;
        }
      }
      let r = random.next() * total;
      let pick = rest.length - 1;
      for (let k = 0; k < rest.length; k++) {
        r -= rest[k].w * scale;
        if (r < 0) {
          pick = k;
          break;
        }
      }
      order.push(rest[pick].i);
      rest.splice(pick, 1);
    }
    return order;
  };

  /**
   * Utility composite: scores every child once, when the composite starts. Children scoring 0 or
   * less, or below `MinScore`, are left out. `Selection` = Highest (default; ties keep the child
   * order) or WeightedRandom (random order weighted by score among the `RandomTop` best, 0 = all;
   * the others follow, best first). `OnChildFailure` = TryNext (default; the next child in the
   * order runs) or Fail (only the first one runs). A chosen child runs until it finishes.
   */
  const utilityOrder = (node: TreeNode, type: CompiledItemType): number[] => {
    const minRaw = propValue(type, node, 'MinScore');
    const minScore = typeof minRaw === 'number' && Number.isFinite(minRaw) ? minRaw : 0;
    const selection = String(propValue(type, node, 'Selection') ?? '').toLowerCase();
    const topRaw = propValue(type, node, 'RandomTop');
    const top = typeof topRaw === 'number' && topRaw > 0 ? Math.floor(topRaw) : 0;
    const failure = String(propValue(type, node, 'OnChildFailure') ?? '').toLowerCase();

    const scored = node.childNodes.map((child, i) => {
      const score = scoreChild(child);
      setScore(child.id, score);
      return { i, w: score };
    });
    const eligible = scored
      .filter((c) => c.w > 0 && c.w >= minScore)
      .sort((a, b) => b.w - a.w || a.i - b.i);

    let order: number[];
    if (selection === 'weightedrandom' && eligible.length > 1) {
      const count = top > 0 ? Math.min(top, eligible.length) : eligible.length;
      order = [
        ...weightedOrder(eligible.slice(0, count)),
        ...eligible.slice(count).map((c) => c.i),
      ];
    } else {
      order = eligible.map((c) => c.i);
    }
    if (failure === 'fail') {
      order = order.slice(0, 1);
    }

    const fmt = (score: number) => String(Math.round(score * 1000) / 1000);
    const list = scored
      .map((c) => `${node.childNodes[c.i].label || node.childNodes[c.i].type} ${fmt(c.w)}`)
      .join(', ');
    const chosen = order.length > 0 ? node.childNodes[order[0]] : undefined;
    add(
      'score',
      node.id,
      `scores: ${list || '(no children)'} → ${chosen ? chosen.label || chosen.type : 'none'}`,
    );
    return order;
  };

  const orderChildren = (node: TreeNode, kind: SimulateComposite, type: CompiledItemType) => {
    if (kind === 'utility') {
      return utilityOrder(node, type);
    }
    const indices = node.childNodes.map((_, i) => i);
    if (kind !== 'randomSelector') {
      return indices;
    }
    const raw = propValue(type, node, 'Weights');
    const weights = String(raw ?? '')
      .split(',')
      .map((w) => (w.trim() === '' ? NaN : Number(w)))
      .map((w) => (Number.isFinite(w) && w > 0 ? w : 1));
    const pool = indices.map((i) => ({ i, w: weights[i] ?? 1 }));
    return weightedOrder(pool);
  };

  const execComposite = (node: TreeNode, state: NodeState, type: CompiledItemType): Outcome => {
    const kind = resolveCompositeKind(type);

    if (kind === 'parallel') {
      const results = (state.body.childResults ??= node.childNodes.map(() => undefined));
      node.childNodes.forEach((child, i) => {
        if (results[i] === undefined || results[i] === 'running') {
          const r = execNode(child);
          results[i] = r;
        }
      });
      const requireOne =
        String(propValue(type, node, 'Policy') ?? '').toLowerCase() === 'requireone';
      if (node.childNodes.length === 0) {
        return requireOne ? 'failure' : 'success';
      }
      const anySuccess = results.includes('success');
      const anyFailure = results.includes('failure');
      const allSuccess = results.every((r) => r === 'success');
      const allFailure = results.every((r) => r === 'failure');
      if (requireOne ? anySuccess : anyFailure) {
        abortChildren(node);
        return requireOne ? 'success' : 'failure';
      }
      if (requireOne ? allFailure : allSuccess) {
        return requireOne ? 'failure' : 'success';
      }
      return 'running';
    }

    const order = (state.order ??= orderChildren(node, kind, type));
    const isSequence = kind === 'sequence';
    while (state.index < order.length) {
      const child = node.childNodes[order[state.index]];
      const r = execNode(child);
      if (r === 'running') {
        return 'running';
      }
      if (isSequence ? r === 'failure' : r === 'success') {
        return r;
      }
      state.index++;
    }
    return isSequence ? 'success' : 'failure';
  };

  const execAction = (node: TreeNode, state: NodeState, type: CompiledItemType): Outcome => {
    const sim = type.simulate;
    const mode = resolveActionMode(sim);
    const finish = (result: ManualResult): ManualResult => {
      if (result === 'success') {
        runEffects(sim?.effects, type, node, node.id);
      }
      return result;
    };

    if (mode === 'manual') {
      const resolved = resolutions.get(node.id);
      if (resolved) {
        resolutions.delete(node.id);
        return finish(resolved);
      }
      if (!state.body.manual) {
        state.body.manual = true;
        pending.add(node.id);
        add('enter', node.id, 'waiting for manual result');
      }
      return 'running';
    }

    if (state.body.duration === undefined) {
      state.body.duration = Math.max(
        0,
        Math.round(evalNumber(sim?.duration, 0, type, node, 'duration')),
      );
    }
    if (state.body.elapsed < state.body.duration) {
      state.body.elapsed++;
      return 'running';
    }

    if (mode === 'success') return finish('success');
    if (mode === 'failure') return 'failure';
    const ok = sim?.condition === undefined ? true : isTruthy(evalText(sim.condition, type, node));
    if (sim?.condition !== undefined) {
      add('result', node.id, `condition ${ok ? 'true' : 'false'}`);
    }
    return ok ? finish('success') : 'failure';
  };

  /** Subtree nodes run the referenced tree (their only child after the expansion). */
  const execSubtree = (node: TreeNode, state: NodeState): Outcome => {
    const problem = expansion.errors.get(node.id);
    const child = node.childNodes[0];
    if (problem || !child) {
      throw new Error(problem?.message ?? 'No tree referenced');
    }
    if (!state.entered) {
      state.entered = true;
      add('enter', node.id, `entering subtree ${expansion.refs.get(node.id) ?? ''}`.trim());
    }
    return execNode(child);
  };

  function execBody(node: TreeNode, state: NodeState): Outcome {
    const type = nodeType(node);
    if (isSubtreeType(type)) {
      return execSubtree(node, state);
    }
    const isComposite = type.isInvalid ? node.childNodes.length > 0 : type.isComposite;
    return isComposite ? execComposite(node, state, type) : execAction(node, state, type);
  }

  /** Applies result decorators (`invert`, `forceSuccess`, `forceFailure`) from `fromIndex` down to `toIndex`. */
  const applyResultDecorators = (
    node: TreeNode,
    initial: ManualResult,
    fromIndex: number,
    toIndex = 0,
  ): ManualResult => {
    let final = initial;
    for (let i = Math.min(fromIndex, node.decorators.length - 1); i >= toIndex; i--) {
      const decorator = node.decorators[i];
      const kind = getItemType(project, 'decorator', decorator.type).simulate?.decorator;
      let next = final;
      if (kind === 'invert') next = final === 'success' ? 'failure' : 'success';
      else if (kind === 'forceSuccess') next = 'success';
      else if (kind === 'forceFailure') next = 'failure';
      if (next !== final) {
        add('decorator', node.id, `${decorator.type}: ${final} → ${next}`, decorator.id);
        final = next;
      }
    }
    return final;
  };

  /** Checks if any timeLimit decorator has expired; returns the failure result (with outer result decorators) or undefined. */
  const checkTimeLimit = (node: TreeNode, state: NodeState): ManualResult | undefined => {
    if (!state.timeLimits || state.timeLimits.length === 0) {
      return undefined;
    }
    const elapsed = tickNo - state.startTick;
    let minExpiredIndex: number | undefined;
    for (const entry of state.timeLimits) {
      if (elapsed >= entry.limit) {
        if (minExpiredIndex === undefined || entry.index < minExpiredIndex) {
          minExpiredIndex = entry.index;
        }
      }
    }
    if (minExpiredIndex === undefined) {
      return undefined;
    }
    abortChildren(node);
    for (const entry of state.timeLimits) {
      if (elapsed >= entry.limit) {
        subStatuses[entry.id] = 'fail';
        add('decorator', node.id, `${entry.type}: time limit reached`, entry.id);
      }
    }
    const final = applyResultDecorators(node, 'failure', minExpiredIndex - 1, 0);
    return finishNode(node, final);
  };

  function execNode(node: TreeNode): Outcome {
    let state = states.get(node.id);

    if (!state) {
      resetChildren(node);
      clearSubStatuses(node);
      statuses[node.id] = 'idle';
      state = {
        startTick: tickNo,
        index: 0,
        body: { elapsed: 0 },
        loopDone: 0,
        loopTotal: 1,
      };

      let currentDecorator: SubItem | undefined;
      try {
        // cooldowns and conditions
        for (let i = 0; i < node.decorators.length; i++) {
          const decorator = node.decorators[i];
          currentDecorator = decorator;
          const type = getItemType(project, 'decorator', decorator.type);
          const sim = type.simulate;
          if (sim?.decorator === 'cooldown') {
            const ticks = evalNumber(sim.ticks, 0, type, decorator, 'ticks');
            const since = cooldownStart.get(decorator.id);
            if (since !== undefined && tickNo - since < ticks) {
              subStatuses[decorator.id] = 'fail';
              add(
                'decorator',
                node.id,
                `${decorator.type}: cooling down (${ticks - (tickNo - since)} ticks left) → fail`,
                decorator.id,
              );
              const final = applyResultDecorators(node, 'failure', i - 1, 0);
              statuses[node.id] = final;
              add('result', node.id, final);
              return final;
            }
          }
          if (!decoratorPasses(node, decorator, type, false)) {
            subStatuses[decorator.id] = 'fail';
            const final = applyResultDecorators(node, 'failure', i - 1, 0);
            statuses[node.id] = final;
            add('result', node.id, final);
            return final;
          }
          subStatuses[decorator.id] = 'pass';
          if (sim?.decorator === 'loop') {
            const count = Math.floor(evalNumber(sim.count, 1, type, decorator, 'count'));
            state.outerLoopIndex ??= i;
            state.loopIndex = i;
            if (count === 0 || state.loopTotal === 0) {
              state.loopTotal = 0;
            } else if (count < 0 || state.loopTotal === Infinity) {
              state.loopTotal = Infinity;
            } else {
              state.loopTotal = state.loopTotal * count;
            }
          }
          if (sim?.decorator === 'timeLimit') {
            const ticks = evalNumber(sim.ticks, 0, type, decorator, 'ticks');
            (state.timeLimits ??= []).push({
              index: i,
              id: decorator.id,
              type: decorator.type,
              limit: ticks,
            });
          }
        }
      } catch (e) {
        if (currentDecorator) {
          subStatuses[currentDecorator.id] = 'fail';
        }
        statuses[node.id] = 'failure';
        add('error', node.id, e instanceof Error ? e.message : String(e), currentDecorator?.id);
        add('result', node.id, 'failure');
        return 'failure';
      }

      states.set(node.id, state);
      statuses[node.id] = 'running';
      add('enter', node.id, 'started');

      if (state.loopTotal === 0) {
        const final = applyResultDecorators(node, 'success', (state.outerLoopIndex ?? 0) - 1, 0);
        return finishNode(node, final);
      }
    } else {
      // resumed: periodic decorators are checked again
      for (let i = 0; i < node.decorators.length; i++) {
        const decorator = node.decorators[i];
        if (!decorator.periodic) continue;
        const type = getItemType(project, 'decorator', decorator.type);
        let pass: boolean;
        try {
          pass = decoratorPasses(node, decorator, type, true);
        } catch (e) {
          subStatuses[decorator.id] = 'fail';
          return failWithError(node, e, decorator.id);
        }
        if (!pass) {
          subStatuses[decorator.id] = 'fail';
          abortChildren(node);
          add('decorator', node.id, `${decorator.type}: condition false, aborting`, decorator.id);
          const final = applyResultDecorators(node, 'failure', i - 1, 0);
          return finishNode(node, final);
        }
      }
    }

    runServices(node, state);

    if (state.restart) {
      // next loop iteration: the finished iteration stays visible until now
      state.restart = false;
      state.entered = false;
      state.index = 0;
      state.order = undefined;
      state.body = { elapsed: 0 };
      resetChildren(node);
    }

    let result: Outcome;
    try {
      result = execBody(node, state);
    } catch (e) {
      return failWithError(node, e);
    }

    if (result === 'running') {
      const timedOut = checkTimeLimit(node, state);
      if (timedOut !== undefined) {
        return timedOut;
      }
      return 'running';
    }
    let final: ManualResult = result;

    // Result decorators inside the loop apply to each iteration before the loop checks success.
    const loopIdx = state.loopIndex;
    if (loopIdx !== undefined) {
      final = applyResultDecorators(node, final, node.decorators.length - 1, loopIdx + 1);
      if (final === 'success' && state.loopDone + 1 < state.loopTotal) {
        const timedOut = checkTimeLimit(node, state);
        if (timedOut !== undefined) {
          return timedOut;
        }
        state.loopDone++;
        state.restart = true;
        add(
          'decorator',
          node.id,
          `loop ${state.loopDone}/${state.loopTotal === Infinity ? '∞' : state.loopTotal} done`,
        );
        return 'running';
      }
      final = applyResultDecorators(node, final, loopIdx - 1, 0);
      return finishNode(node, final);
    }

    // result decorators, innermost (last) first
    final = applyResultDecorators(node, final, node.decorators.length - 1, 0);
    return finishNode(node, final);
  }

  // ----- passes -----

  /** Prepares the next pass: everything but the blackboard, the tick counter and cooldowns restarts. */
  const startNextPass = (): void => {
    pass++;
    states.clear();
    resolutions.clear();
    pending.clear();
    ranServices = [];
    for (const key of Object.keys(statuses)) statuses[key] = 'idle';
    for (const key of Object.keys(subStatuses)) delete subStatuses[key];
    if (scoreCount > 0) {
      for (const key of Object.keys(scores)) delete scores[key];
      scoreCount = 0;
    }
  };

  // ----- public API -----

  const snapshotResult = (entries: LogEntry[], copyLog = true): TickResult => {
    const result: TickResult = {
      tick: tickNo,
      pass,
      passes: loops,
      statuses: { ...statuses },
      subStatuses: { ...subStatuses },
      blackboard: deepClone(blackboard),
      log: copyLog ? [...entries] : entries,
    };
    if (scoreCount > 0) result.scores = { ...scores };
    if (finished) result.finished = finished;
    if (passResult !== undefined && (loops !== 1 || pass > 1)) result.passResult = passResult;
    const first = firstPending();
    if (first !== undefined) result.pendingManual = first;
    return result;
  };

  const advanceTick = (): LogEntry[] => {
    if (finished || pending.size > 0) {
      return [];
    }
    tickNo++;
    log = [];
    const restart = passResult !== undefined;
    passResult = undefined;
    if (restart) {
      startNextPass();
    } else if (ranServices.length > 0) {
      for (const key of ranServices) {
        if (subStatuses[key] === 'ran') delete subStatuses[key];
      }
      ranServices = [];
    }
    if (loops !== 1 && (restart || tickNo === 1)) {
      add('pass', root.id, `Run ${pass}/${loops === 0 ? '∞' : loops} started`);
    }
    const result = execNode(root);
    if (result !== 'running') {
      passResult = result;
      if (loops !== 1) {
        add(
          'pass',
          root.id,
          `Run ${pass}/${loops === 0 ? '∞' : loops} finished: ${result === 'success' ? 'Success' : 'Failure'}`,
        );
      }
      if (loops !== 0 && pass >= loops) {
        finished = result;
      }
    }
    return log;
  };

  return {
    root,
    tick() {
      const entries = advanceTick();
      return snapshotResult(entries, false);
    },
    step() {
      const entries = advanceTick();
      const result: StepResult = { tick: tickNo, log: entries };
      if (finished) result.finished = finished;
      const first = firstPending();
      if (first !== undefined) result.pendingManual = first;
      return result;
    },
    resolveManual(nodeId, result) {
      if (!pending.has(nodeId)) {
        throw new Error(`Node '${nodeId}' is not waiting for a manual result`);
      }
      pending.delete(nodeId);
      resolutions.set(nodeId, result);
    },
    pendingManual: firstPending,
    snapshot: () => snapshotResult(log),
    setBlackboardValue(key, value) {
      setOwnProperty(blackboard, key, deepClone(value));
    },
    removeBlackboardKey(key) {
      delete blackboard[key];
    },
    setLoops(value) {
      if (finished) return;
      loops = normalizeLoops(value);
      if (loops !== 0 && loops < pass) loops = pass;
      if (passResult !== undefined && loops !== 0 && pass >= loops) {
        finished = passResult;
      }
    },
    checkpoint() {
      const data: CheckpointData = {
        blackboard: deepClone(blackboard),
        statuses: { ...statuses },
        subStatuses: { ...subStatuses },
        scores: { ...scores },
        states: [...states].map(([id, state]) => [id, deepClone(state)]),
        cooldownStart: [...cooldownStart],
        resolutions: [...resolutions],
        pending: [...pending],
        finished,
        tickNo,
        loops,
        pass,
        passResult,
        log: [...log],
        random: random.state,
      };
      return data as unknown as RunCheckpoint;
    },
    restore(checkpoint) {
      const data = checkpoint as unknown as CheckpointData;
      for (const key of Object.keys(blackboard)) delete blackboard[key];
      for (const [key, value] of Object.entries(deepClone(data.blackboard))) {
        setOwnProperty(blackboard, key, value);
      }
      for (const key of Object.keys(statuses)) delete statuses[key];
      Object.assign(statuses, data.statuses);
      for (const key of Object.keys(subStatuses)) delete subStatuses[key];
      Object.assign(subStatuses, data.subStatuses);
      ranServices = Object.entries(subStatuses)
        .filter(([, status]) => status === 'ran')
        .map(([id]) => id);
      for (const key of Object.keys(scores)) delete scores[key];
      Object.assign(scores, data.scores);
      scoreCount = Object.keys(scores).length;
      states.clear();
      for (const [id, state] of data.states) states.set(id, deepClone(state));
      cooldownStart.clear();
      for (const [id, start] of data.cooldownStart) cooldownStart.set(id, start);
      resolutions.clear();
      for (const [id, result] of data.resolutions) resolutions.set(id, result);
      pending.clear();
      for (const id of data.pending) pending.add(id);
      finished = data.finished;
      tickNo = data.tickNo;
      loops = data.loops;
      pass = data.pass;
      passResult = data.passResult;
      log = [...data.log];
      random.state = data.random;
    },
  };
}

/** Finds the node by id; convenience for UI code that needs the label of a log entry. */
export function findRunNode(root: TreeNode, id: string): TreeNode | undefined {
  return findNode(root, id);
}
