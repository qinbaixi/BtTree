import { getItemType } from '../compileProject';
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
  'enter' | 'result' | 'blackboard' | 'service' | 'error' | 'decorator' | 'pass';
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
  /** Seed of the pseudo random generator (RandomSelector). Default 1. */
  seed?: number;
  /** Property overrides by node / decorator / service id. */
  overrides?: Record<string, Record<string, unknown>>;
  /** Number of times the tree runs (integer >= 0; default 1; 0 = endless). */
  loops?: number;
}

/** Normalizes a loops value: integer >= 0, anything else becomes 1. */
export function normalizeLoops(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 1;
  return Math.max(0, Math.floor(value));
}

export interface Run {
  /** Executes one tick. Does nothing (returns the current state) while finished or waiting for a manual result. */
  tick(): TickResult;
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

const COMPOSITE_BY_NAME: Record<string, SimulateComposite> = {
  selector: 'selector',
  sequence: 'sequence',
  parallel: 'parallel',
  randomselector: 'randomSelector',
};

/** Composite kind of a node type: simulate.composite, else the (base) type name, else sequence. */
export function resolveCompositeKind(type: CompiledItemType): SimulateComposite {
  if (type.simulate?.composite) {
    return type.simulate.composite;
  }
  for (const name of [type.name, ...(type.bases ?? [])]) {
    const found = COMPOSITE_BY_NAME[name.toLowerCase()];
    if (found) {
      return found;
    }
  }
  return 'sequence';
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
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

function deepClone<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(deepClone) as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = deepClone(inner);
    }
    return out as T;
  }
  return value;
}

// ---------- engine ----------

interface BodyState {
  elapsed: number;
  duration?: number;
  manual?: boolean;
  childResults?: Array<Outcome | undefined>;
}

interface NodeState {
  startTick: number;
  index: number;
  order?: number[];
  body: BodyState;
  loopDone: number;
  /** The body restarts at the start of the next tick (loop decorator). */
  restart?: boolean;
  loopTotal: number;
  timeLimit?: number;
}

export function createRun(root: TreeNode, project: CompiledProject, options: RunOptions): Run {
  const blackboard: Record<string, unknown> = deepClone(options.blackboard);
  const overrides = options.overrides ?? {};
  const random = createRandom(options.seed ?? 1);

  const statuses: Record<string, RunStatus> = {};
  const subStatuses: Record<string, SubStatus> = {};
  const states = new Map<string, NodeState>();
  const cooldownStart = new Map<string, number>();
  const resolutions = new Map<string, ManualResult>();
  let pending: string[] = [];
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
    const own = overrides[owner.id];
    if (own && Object.hasOwn(own, name) && own[name] !== undefined) {
      return own[name];
    }
    const prop = type.properties.find((p) => p.name === name);
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
    blackboard[key] = value;
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
    for (const src of effects ?? []) {
      let assignment = assignCache.get(src);
      if (!assignment) {
        assignment = parseAssignment(src);
        assignCache.set(src, assignment);
      }
      const value = evaluate(assignment.expr, ctxFor(type, owner));
      setBlackboard(assignment.target, value, nodeId, itemId);
    }
  };

  // ----- bookkeeping -----

  const dropManual = (id: string): void => {
    pending = pending.filter((p) => p !== id);
    resolutions.delete(id);
  };

  const clearSubStatuses = (node: TreeNode): void => {
    for (const item of [...node.decorators, ...node.services]) {
      delete subStatuses[item.id];
    }
  };

  /** Resets all descendants to idle (used when a node (re)starts). */
  const resetChildren = (node: TreeNode): void => {
    for (const child of node.childNodes) {
      states.delete(child.id);
      statuses[child.id] = 'idle';
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
      add('service', node.id, `${service.type} ticked`, service.id);
      try {
        runEffects(type.simulate?.effects, type, service, node.id, service.id);
      } catch (e) {
        add('error', node.id, e instanceof Error ? e.message : String(e), service.id);
      }
    }
  };

  const orderChildren = (node: TreeNode, kind: SimulateComposite, type: CompiledItemType) => {
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
    const order: number[] = [];
    while (pool.length > 0) {
      const total = pool.reduce((sum, p) => sum + p.w, 0);
      let r = random.next() * total;
      let pick = 0;
      for (let k = 0; k < pool.length; k++) {
        r -= pool[k].w;
        if (r < 0) {
          pick = k;
          break;
        }
        pick = k;
      }
      order.push(pool[pick].i);
      pool.splice(pick, 1);
    }
    return order;
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
        return 'success';
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
        pending.push(node.id);
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

  function execBody(node: TreeNode, state: NodeState): Outcome {
    const type = nodeType(node);
    const isComposite = type.isComposite || (type.isInvalid === true && node.childNodes.length > 0);
    return isComposite ? execComposite(node, state, type) : execAction(node, state, type);
  }

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

      try {
        // cooldowns and conditions
        for (const decorator of node.decorators) {
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
              statuses[node.id] = 'failure';
              add('result', node.id, 'failure');
              return 'failure';
            }
          }
          if (!decoratorPasses(node, decorator, type, false)) {
            subStatuses[decorator.id] = 'fail';
            statuses[node.id] = 'failure';
            add('result', node.id, 'failure');
            return 'failure';
          }
          subStatuses[decorator.id] = 'pass';
          if (sim?.decorator === 'loop') {
            const count = Math.floor(evalNumber(sim.count, 1, type, decorator, 'count'));
            state.loopTotal =
              count < 0 || state.loopTotal === Infinity ? Infinity : state.loopTotal * count;
          }
          if (sim?.decorator === 'timeLimit') {
            const ticks = evalNumber(sim.ticks, 0, type, decorator, 'ticks');
            state.timeLimit = Math.min(state.timeLimit ?? Infinity, ticks);
          }
        }
      } catch (e) {
        statuses[node.id] = 'failure';
        add('error', node.id, e instanceof Error ? e.message : String(e));
        add('result', node.id, 'failure');
        return 'failure';
      }

      states.set(node.id, state);
      statuses[node.id] = 'running';
      add('enter', node.id, 'started');
    } else {
      // resumed: periodic decorators are checked again
      for (const decorator of node.decorators) {
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
          return finishNode(node, 'failure');
        }
      }
    }

    runServices(node, state);

    if (state.restart) {
      // next loop iteration: the finished iteration stays visible until now
      state.restart = false;
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
      if (state.timeLimit !== undefined && tickNo - state.startTick >= state.timeLimit) {
        abortChildren(node);
        for (const decorator of node.decorators) {
          if (
            getItemType(project, 'decorator', decorator.type).simulate?.decorator === 'timeLimit'
          ) {
            subStatuses[decorator.id] = 'fail';
            add('decorator', node.id, `${decorator.type}: time limit reached`, decorator.id);
          }
        }
        return finishNode(node, 'failure');
      }
      return 'running';
    }
    let final: ManualResult = result;

    // loops: repeat the body (from the next tick on) after each success
    if (final === 'success' && state.loopDone + 1 < state.loopTotal) {
      state.loopDone++;
      state.restart = true;
      add(
        'decorator',
        node.id,
        `loop ${state.loopDone}/${state.loopTotal === Infinity ? '∞' : state.loopTotal} done`,
      );
      return 'running';
    }

    // result decorators, innermost (last) first
    for (let i = node.decorators.length - 1; i >= 0; i--) {
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
    return finishNode(node, final);
  }

  // ----- passes -----

  /** Prepares the next pass: everything but the blackboard, the tick counter and cooldowns restarts. */
  const startNextPass = (): void => {
    pass++;
    states.clear();
    resolutions.clear();
    pending = [];
    for (const key of Object.keys(statuses)) statuses[key] = 'idle';
    for (const key of Object.keys(subStatuses)) delete subStatuses[key];
  };

  // ----- public API -----

  const snapshotResult = (entries: LogEntry[]): TickResult => {
    const result: TickResult = {
      tick: tickNo,
      pass,
      passes: loops,
      statuses: { ...statuses },
      subStatuses: { ...subStatuses },
      blackboard: deepClone(blackboard),
      log: [...entries],
    };
    if (finished) result.finished = finished;
    if (passResult !== undefined && (loops !== 1 || pass > 1)) result.passResult = passResult;
    if (pending.length > 0) result.pendingManual = pending[0];
    return result;
  };

  return {
    tick() {
      if (finished || pending.length > 0) {
        return snapshotResult([]);
      }
      tickNo++;
      log = [];
      const restart = passResult !== undefined;
      passResult = undefined;
      if (restart) {
        startNextPass();
      } else {
        for (const key of Object.keys(subStatuses)) {
          if (subStatuses[key] === 'ran') delete subStatuses[key];
        }
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
      return snapshotResult(log);
    },
    resolveManual(nodeId, result) {
      if (!pending.includes(nodeId)) {
        throw new Error(`Node '${nodeId}' is not waiting for a manual result`);
      }
      pending = pending.filter((p) => p !== nodeId);
      resolutions.set(nodeId, result);
    },
    pendingManual: () => pending[0],
    snapshot: () => snapshotResult(log),
    setBlackboardValue(key, value) {
      blackboard[key] = value;
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
      Object.assign(blackboard, deepClone(data.blackboard));
      for (const key of Object.keys(statuses)) delete statuses[key];
      Object.assign(statuses, data.statuses);
      for (const key of Object.keys(subStatuses)) delete subStatuses[key];
      Object.assign(subStatuses, data.subStatuses);
      states.clear();
      for (const [id, state] of data.states) states.set(id, deepClone(state));
      cooldownStart.clear();
      for (const [id, start] of data.cooldownStart) cooldownStart.set(id, start);
      resolutions.clear();
      for (const [id, result] of data.resolutions) resolutions.set(id, result);
      pending = [...data.pending];
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
