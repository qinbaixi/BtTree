import type { CompiledProject, ScenarioJson, TreeNode } from '../types';
import { createRun, formatValue, type ManualResult } from './engine';

/*
 * Scenario tests (`owlbt test`): runs a tree with the start blackboard of a scenario until the root
 * finishes (or the tick budget runs out) and compares the outcome with the scenario's `expect`.
 * Pure and deterministic, like the engine.
 */

/** Tick budget of one run when the scenario has no `maxTicks`. */
export const DEFAULT_SCENARIO_MAX_TICKS = 1000;
/** Upper limit of `maxTicks` (keeps a typo from hanging CI). */
export const MAX_SCENARIO_TICKS = 1_000_000;

export type ScenarioRunResult = 'success' | 'failure' | 'running';

/**
 * `pass` / `fail`: the scenario has expectations and they were (not) met.
 * `ran`: the scenario has no `expect`; only the result is reported.
 */
export type ScenarioTestStatus = 'pass' | 'fail' | 'ran';

export interface BlackboardMismatch {
  key: string;
  expected: unknown;
  /** Undefined when the key is not set. */
  actual: unknown;
}

export interface ScenarioTestOutcome {
  status: ScenarioTestStatus;
  /** Result of the root node; `running` when it did not finish within the tick budget. */
  result: ScenarioRunResult;
  /** Ticks executed. */
  ticks: number;
  maxTicks: number;
  /** Why the test failed, one line each (empty when it passed). */
  failures: string[];
  mismatches: BlackboardMismatch[];
  /** Error messages the engine logged (expression errors and the like). */
  errors: string[];
  /** Number of manual actions that were resolved automatically. */
  manualResolved: number;
  /** Blackboard after the run. */
  blackboard: Record<string, unknown>;
}

/** True when the scenario has an `expect` object (even an empty one). */
export function hasExpectations(scenario: ScenarioJson): boolean {
  return typeof scenario.expect === 'object' && scenario.expect !== null;
}

/** Effective tick budget of a scenario. */
export function scenarioMaxTicks(scenario: ScenarioJson): number {
  const value = scenario.maxTicks;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    return DEFAULT_SCENARIO_MAX_TICKS;
  }
  return Math.min(value, MAX_SCENARIO_TICKS);
}

/** Deep equality of JSON values (object key order does not matter). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => jsonEqual(item, b[i]));
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keys = Object.keys(ra);
  return (
    keys.length === Object.keys(rb).length &&
    keys.every((key) => Object.hasOwn(rb, key) && jsonEqual(ra[key], rb[key]))
  );
}

/** Compares the expected blackboard values; `null` matches an unset key too. */
export function compareBlackboard(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
): BlackboardMismatch[] {
  const mismatches: BlackboardMismatch[] = [];
  for (const [key, value] of Object.entries(expected)) {
    const has = Object.hasOwn(actual, key);
    const ok = has ? jsonEqual(value, actual[key]) : value === null;
    if (!ok) {
      mismatches.push({ key, expected: value, actual: has ? actual[key] : undefined });
    }
  }
  return mismatches;
}

/** Runs one tree in one scenario and checks the scenario's expectations. */
export function runScenarioTest(
  root: TreeNode,
  project: CompiledProject,
  scenario: ScenarioJson,
): ScenarioTestOutcome {
  const maxTicks = scenarioMaxTicks(scenario);
  const manual: ManualResult = scenario.manual === 'failure' ? 'failure' : 'success';
  const blackboard =
    typeof scenario.blackboard === 'object' && scenario.blackboard !== null
      ? scenario.blackboard
      : {};
  const seed =
    typeof scenario.seed === 'number' && Number.isFinite(scenario.seed) ? scenario.seed : 1;
  const run = createRun(root, project, { blackboard, seed });

  const errors: string[] = [];
  let manualResolved = 0;
  let state = run.snapshot();
  while (state.tick < maxTicks && !state.finished) {
    for (let pending = run.pendingManual(); pending; pending = run.pendingManual()) {
      run.resolveManual(pending, manual);
      manualResolved++;
    }
    state = run.tick();
    for (const entry of state.log) {
      if (entry.kind === 'error') errors.push(`tick ${entry.tick}: ${entry.message}`);
    }
  }

  const result: ScenarioRunResult = state.finished ?? 'running';
  const outcome: ScenarioTestOutcome = {
    status: 'ran',
    result,
    ticks: state.tick,
    maxTicks,
    failures: [],
    mismatches: [],
    errors,
    manualResolved,
    blackboard: state.blackboard,
  };
  if (!hasExpectations(scenario)) {
    return outcome;
  }

  const expect = scenario.expect ?? {};
  const failures = outcome.failures;
  if (expect.result !== undefined && expect.result !== result) {
    failures.push(
      result === 'running'
        ? `expected ${expect.result}, but the tree did not finish within ${maxTicks} ticks`
        : `expected ${expect.result}, got ${result}`,
    );
  } else if (expect.result === undefined && result === 'running') {
    failures.push(`the tree did not finish within ${maxTicks} ticks`);
  }
  if (expect.ticks !== undefined && expect.ticks !== outcome.ticks) {
    failures.push(`expected ${expect.ticks} ticks, took ${outcome.ticks}`);
  }
  if (typeof expect.blackboard === 'object' && expect.blackboard !== null) {
    outcome.mismatches = compareBlackboard(expect.blackboard, state.blackboard);
    for (const m of outcome.mismatches) {
      failures.push(
        `blackboard ${m.key}: expected ${formatValue(m.expected)}, got ${formatValue(m.actual)}`,
      );
    }
  }
  outcome.status = failures.length === 0 ? 'pass' : 'fail';
  return outcome;
}

// ---------- tree selection ----------

/** Normalizes a relative path: forward slashes, no leading `./`. */
export function normalizeRelPath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, '/')
    .replace(/^(\.\/)+/, '');
}

/** Converts a glob (`*`, `**`, `?`) to an anchored regular expression. Paths use `/`. */
export function globToRegExp(glob: string): RegExp {
  const pattern = normalizeRelPath(glob);
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        i++;
        if (pattern[i + 1] === '/') {
          i++;
          out += '(?:.*/)?';
        } else {
          out += '.*';
        }
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}

/** The `trees` patterns of a scenario as a list (empty = every tree). */
export function scenarioTreePatterns(scenario: ScenarioJson): string[] {
  const raw = scenario.trees;
  const list = typeof raw === 'string' ? [raw] : Array.isArray(raw) ? raw : [];
  return list.filter((p): p is string => typeof p === 'string' && p.trim() !== '');
}

/** True when the scenario applies to the tree (path relative to the project folder). */
export function scenarioAppliesTo(scenario: ScenarioJson, relPath: string): boolean {
  const patterns = scenarioTreePatterns(scenario);
  if (patterns.length === 0) {
    return true;
  }
  const path = normalizeRelPath(relPath);
  return patterns.some((p) => globToRegExp(p).test(path));
}

// ---------- validation ----------

export interface ScenarioIssue {
  /** Field path below the scenario, e.g. `expect.result`. */
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Checks the scenario-test fields of a scenario (`trees`, `maxTicks`, `seed`, `manual`, `expect`). */
export function validateScenarioTestFields(scenario: ScenarioJson): ScenarioIssue[] {
  const issues: ScenarioIssue[] = [];
  const error = (field: string, message: string) =>
    issues.push({ field, message, severity: 'error' });

  const { trees, maxTicks, seed, manual, expect } = scenario;
  if (trees !== undefined) {
    const list = typeof trees === 'string' ? [trees] : trees;
    if (!Array.isArray(list) || list.some((p) => typeof p !== 'string' || p.trim() === '')) {
      error('trees', 'trees must be a path / glob or a list of non-empty paths / globs');
    }
  }
  if (
    maxTicks !== undefined &&
    (typeof maxTicks !== 'number' ||
      !Number.isInteger(maxTicks) ||
      maxTicks < 1 ||
      maxTicks > MAX_SCENARIO_TICKS)
  ) {
    error('maxTicks', `maxTicks must be an integer from 1 to ${MAX_SCENARIO_TICKS}`);
  }
  if (seed !== undefined && (typeof seed !== 'number' || !Number.isInteger(seed))) {
    error('seed', 'seed must be an integer');
  }
  if (manual !== undefined && manual !== 'success' && manual !== 'failure') {
    error('manual', "manual must be 'success' or 'failure'");
  }
  if (expect === undefined) {
    return issues;
  }
  if (!isPlainObject(expect)) {
    error('expect', 'expect must be an object');
    return issues;
  }
  const { result, ticks, blackboard } = expect;
  if (
    result !== undefined &&
    result !== 'success' &&
    result !== 'failure' &&
    result !== 'running'
  ) {
    error('expect.result', "expect.result must be 'success', 'failure' or 'running'");
  }
  if (ticks !== undefined) {
    if (typeof ticks !== 'number' || !Number.isInteger(ticks) || ticks < 0) {
      error('expect.ticks', 'expect.ticks must be an integer >= 0');
    } else if (ticks > scenarioMaxTicks(scenario)) {
      error(
        'expect.ticks',
        `expect.ticks (${ticks}) is larger than maxTicks (${scenarioMaxTicks(scenario)})`,
      );
    }
  }
  if (blackboard !== undefined && !isPlainObject(blackboard)) {
    error('expect.blackboard', 'expect.blackboard must be an object');
  }
  return issues;
}
