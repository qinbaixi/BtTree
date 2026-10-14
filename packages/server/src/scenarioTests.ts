import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import {
  collectSubtreeRefsJson,
  compileProject,
  createIdGen,
  globToRegExp,
  hasExpectations,
  nodeFromJson,
  normalizeRelPath,
  runScenarioTest,
  scenarioAppliesTo,
  scenarioTreePatterns,
  validateProjectFile,
  type BlackboardMismatch,
  type CompiledProject,
  type ProjectFile,
  type ScenarioJson,
  type ScenarioRunResult,
  type SubtreeLibrary,
  type TreeNodeJson,
} from '@owlbt/shared';
import { isPathInDir, PROJECT_FILE_NAME } from './project';
import { loadSubtreeLibrary } from './subtrees';
import { loadWorkspace } from './workspace';

/*
 * Batch scenario tests (`owlbt test`, POST /api/scenario-tests): runs every tree × scenario
 * combination of a project with the simulation engine. Never runs the project plugin (owl-bt.js).
 */

/** The configuration is unusable (no project, invalid owl-bt.json, filters that match nothing). */
export class ScenarioConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScenarioConfigError';
  }
}

/** `error`: the tree could not be loaded or simulated. */
export type ScenarioCaseStatus = 'pass' | 'fail' | 'ran' | 'error';

export interface ScenarioTestCase {
  /** Tree path relative to the project folder, with forward slashes. */
  tree: string;
  treePath: string;
  scenario: string;
  status: ScenarioCaseStatus;
  /** Whether the scenario has expectations. */
  expect: boolean;
  result?: ScenarioRunResult;
  ticks?: number;
  maxTicks?: number;
  failures: string[];
  mismatches: BlackboardMismatch[];
  /** Engine errors logged during the run. */
  errors: string[];
  /** Run time in milliseconds. */
  durationMs: number;
}

export interface ScenarioTestSummary {
  total: number;
  passed: number;
  failed: number;
  /** Scenarios without expectations (result only). */
  ran: number;
  errors: number;
}

export interface ScenarioTestReport {
  projectDir: string;
  projectPath: string;
  cases: ScenarioTestCase[];
  warnings: string[];
  summary: ScenarioTestSummary;
  /** True when no case failed or errored. */
  ok: boolean;
}

export interface ScenarioTestOptions {
  /** Tree filters: relative paths, names without `.json`, or globs. Any match keeps the tree. */
  trees?: string[];
  /** Scenario names to run. Unknown names are configuration errors. */
  scenarios?: string[];
  /** Project content to use instead of owl-bt.json on disk (unsaved edits in the editor). */
  project?: ProjectFile;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const GLOB_CHARS = /[*?]/;

const UTF8_BOM = String.fromCharCode(0xfeff);

function stripBom(text: string): string {
  return text.startsWith(UTF8_BOM) ? text.slice(1) : text;
}

/** True when a `--tree` filter selects the tree (relative path). */
export function treeFilterMatches(filter: string, relPath: string): boolean {
  const f = normalizeRelPath(filter);
  if (f === '') return false;
  if (GLOB_CHARS.test(f)) {
    return globToRegExp(f).test(relPath) || globToRegExp(`**/${f}`).test(relPath);
  }
  const withoutExt = relPath.replace(/\.json$/i, '');
  return (
    relPath === f || withoutExt === f || relPath.endsWith(`/${f}`) || withoutExt.endsWith(`/${f}`)
  );
}

async function readProjectFile(path: string): Promise<ProjectFile> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    throw new ScenarioConfigError(`Cannot read ${path}: ${messageOf(err)}`);
  }
  try {
    const json = JSON.parse(stripBom(text)) as unknown;
    if (typeof json !== 'object' || json === null || Array.isArray(json)) {
      throw new Error('Project file must contain a JSON object');
    }
    return json as ProjectFile;
  } catch (err) {
    throw new ScenarioConfigError(`Invalid project file ${path}: ${messageOf(err)}`);
  }
}

/**
 * Runs the scenario tests for a tree file, a folder (its trees) or a project folder (every tree).
 * Throws ScenarioConfigError for configuration problems; problems of single trees become `error` cases.
 */
export async function runScenarioTests(
  rawPath: string,
  options: ScenarioTestOptions = {},
): Promise<ScenarioTestReport> {
  let target = resolve(rawPath);
  let isFile: boolean;
  try {
    isFile = (await stat(target)).isFile();
  } catch {
    throw new ScenarioConfigError(`No such file or directory: ${target}`);
  }
  if (isFile && basename(target) === PROJECT_FILE_NAME) {
    // owl-bt.json itself stands for its project.
    target = dirname(target);
    isFile = false;
  }
  const workspace = await loadWorkspace(target);
  if (workspace.projectPath === undefined || workspace.projectDir === undefined) {
    throw new ScenarioConfigError(`No owl-bt.json found for ${target}`);
  }
  const projectDir = workspace.projectDir;
  const projectPath = workspace.projectPath;
  const file = options.project ?? (await readProjectFile(projectPath));

  let compiled: CompiledProject;
  try {
    compiled = compileProject(file);
  } catch (err) {
    throw new ScenarioConfigError(`Invalid project file ${projectPath}: ${messageOf(err)}`);
  }
  const scenarioIssues = validateProjectFile(file).filter(
    (issue) => issue.severity === 'error' && issue.path.startsWith('scenarios'),
  );
  if (scenarioIssues.length > 0) {
    throw new ScenarioConfigError(
      `Invalid scenarios in ${projectPath}:\n` +
        scenarioIssues.map((issue) => `  ${issue.path}: ${issue.message}`).join('\n'),
    );
  }

  const warnings: string[] = [];
  if (workspace.truncated) {
    warnings.push('Only the first 500 tree files of the project were tested');
  }

  // Trees: the file itself, the trees below the folder, or every tree of the project.
  const toRel = (path: string) => relative(projectDir, path).split(sep).join('/');
  let trees = workspace.trees.map((tree) => ({ path: tree.path, relPath: toRel(tree.path) }));
  if (isFile) {
    if (!isPathInDir(target, projectDir)) {
      throw new ScenarioConfigError(`${target} is not in the project ${projectDir}`);
    }
    trees = [{ path: target, relPath: toRel(target) }];
  } else if (target !== projectDir) {
    trees = trees.filter((tree) => isPathInDir(tree.path, target));
  }
  if (options.trees && options.trees.length > 0) {
    const filters = options.trees;
    for (const filter of filters) {
      if (!trees.some((tree) => treeFilterMatches(filter, tree.relPath))) {
        throw new ScenarioConfigError(`No tree matches --tree ${filter}`);
      }
    }
    trees = trees.filter((tree) => filters.some((f) => treeFilterMatches(f, tree.relPath)));
  }

  let scenarios: ScenarioJson[] = file.scenarios ?? [];
  if (options.scenarios && options.scenarios.length > 0) {
    const names = options.scenarios;
    for (const name of names) {
      if (!scenarios.some((s) => s.name === name)) {
        throw new ScenarioConfigError(`Unknown scenario '${name}'`);
      }
    }
    scenarios = scenarios.filter((s) => names.includes(s.name));
  }
  if (scenarios.length === 0) {
    throw new ScenarioConfigError(`No scenarios defined in ${projectPath}`);
  }
  for (const scenario of scenarios) {
    const patterns = scenarioTreePatterns(scenario);
    if (
      patterns.length > 0 &&
      !workspace.trees.some((tree) => scenarioAppliesTo(scenario, toRel(tree.path)))
    ) {
      warnings.push(`Scenario '${scenario.name}': trees ${patterns.join(', ')} match no tree`);
    }
  }

  const cases: ScenarioTestCase[] = [];
  for (const tree of trees) {
    const applicable = scenarios.filter((s) => scenarioAppliesTo(s, tree.relPath));
    if (applicable.length === 0) continue;
    let json: TreeNodeJson | undefined;
    let loadError: string | undefined;
    let subtrees: SubtreeLibrary | undefined;
    try {
      json = JSON.parse(stripBom(await readFile(tree.path, 'utf8'))) as TreeNodeJson;
      nodeFromJson(json, createIdGen());
    } catch (err) {
      loadError = `Cannot load tree: ${messageOf(err)}`;
    }
    for (const scenario of applicable) {
      const base = {
        tree: tree.relPath,
        treePath: tree.path,
        scenario: scenario.name,
        expect: hasExpectations(scenario),
        mismatches: [],
        errors: [],
      };
      if (json === undefined) {
        cases.push({ ...base, status: 'error', failures: [loadError ?? ''], durationMs: 0 });
        continue;
      }
      const started = performance.now();
      try {
        // Referenced trees are loaded once per tree (without the project plugin).
        subtrees ??= await loadSubtreeLibrary(
          projectDir,
          compiled,
          collectSubtreeRefsJson(json, compiled),
        );
        const outcome = runScenarioTest(nodeFromJson(json, createIdGen()), compiled, scenario, {
          subtrees,
          treeRef: tree.relPath,
        });
        cases.push({
          ...base,
          status: outcome.status,
          result: outcome.result,
          ticks: outcome.ticks,
          maxTicks: outcome.maxTicks,
          failures: outcome.failures,
          mismatches: outcome.mismatches,
          errors: outcome.errors,
          durationMs: performance.now() - started,
        });
      } catch (err) {
        cases.push({
          ...base,
          status: 'error',
          failures: [`Simulation failed: ${messageOf(err)}`],
          durationMs: performance.now() - started,
        });
      }
    }
  }
  if (cases.length === 0) {
    throw new ScenarioConfigError('No scenario tests to run (no tree matches the scenarios)');
  }

  const summary: ScenarioTestSummary = {
    total: cases.length,
    passed: cases.filter((c) => c.status === 'pass').length,
    failed: cases.filter((c) => c.status === 'fail').length,
    ran: cases.filter((c) => c.status === 'ran').length,
    errors: cases.filter((c) => c.status === 'error').length,
  };
  return {
    projectDir,
    projectPath,
    cases,
    warnings,
    summary,
    ok: summary.failed === 0 && summary.errors === 0,
  };
}

// ---------- output ----------

const STATUS_LABEL: Record<ScenarioCaseStatus, string> = {
  pass: 'PASS',
  fail: 'FAIL',
  ran: 'RAN ',
  error: 'ERR ',
};

/** Human readable report, one line per case plus the failure reasons and a summary. */
export function formatScenarioReport(report: ScenarioTestReport): string {
  const lines: string[] = [];
  for (const c of report.cases) {
    const detail =
      c.result === undefined ? '' : ` → ${c.result} in ${c.ticks} tick${c.ticks === 1 ? '' : 's'}`;
    lines.push(`${STATUS_LABEL[c.status]} ${c.tree} › ${c.scenario}${detail}`);
    for (const failure of c.failures) {
      lines.push(`       ${failure}`);
    }
    for (const error of c.errors.slice(0, 5)) {
      lines.push(`       engine error: ${error}`);
    }
    if (c.errors.length > 5) {
      lines.push(`       ... ${c.errors.length - 5} more engine errors`);
    }
  }
  for (const warning of report.warnings) {
    lines.push(`warning: ${warning}`);
  }
  const s = report.summary;
  const parts = [`${s.passed} passed`, `${s.failed} failed`];
  if (s.errors > 0) parts.push(`${s.errors} errors`);
  if (s.ran > 0) parts.push(`${s.ran} without expectations`);
  lines.push('');
  lines.push(`${s.total} scenario test${s.total === 1 ? '' : 's'}: ${parts.join(', ')}`);
  return lines.join('\n');
}

function xmlEscape(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  // Control characters other than tab and line breaks are not allowed in XML 1.0.
  return [...escaped]
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
    })
    .join('');
}

/** JUnit XML: one test suite per tree, one test case per scenario. */
export function toJUnitXml(report: ScenarioTestReport): string {
  const seconds = (ms: number) => (ms / 1000).toFixed(3);
  const byTree = new Map<string, ScenarioTestCase[]>();
  for (const c of report.cases) {
    const list = byTree.get(c.tree) ?? [];
    list.push(c);
    byTree.set(c.tree, list);
  }
  const s = report.summary;
  const total = report.cases.reduce((sum, c) => sum + c.durationMs, 0);
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  out.push(
    `<testsuites name="owlbt scenario tests" tests="${s.total}" failures="${s.failed}" errors="${s.errors}" time="${seconds(total)}">`,
  );
  for (const [tree, cases] of byTree) {
    const failures = cases.filter((c) => c.status === 'fail').length;
    const errors = cases.filter((c) => c.status === 'error').length;
    const time = cases.reduce((sum, c) => sum + c.durationMs, 0);
    out.push(
      `  <testsuite name="${xmlEscape(tree)}" tests="${cases.length}" failures="${failures}" errors="${errors}" time="${seconds(time)}">`,
    );
    for (const c of cases) {
      const className = xmlEscape(tree.replace(/\.json$/i, '').replace(/\//g, '.'));
      const open = `    <testcase name="${xmlEscape(c.scenario)}" classname="${className}" time="${seconds(c.durationMs)}"`;
      const message = xmlEscape(c.failures.join('; '));
      const body = xmlEscape(c.failures.join('\n'));
      const children: string[] = [];
      if (c.status === 'fail') {
        children.push(
          `      <failure message="${message}" type="ScenarioExpectation">${body}</failure>`,
        );
      } else if (c.status === 'error') {
        children.push(`      <error message="${message}" type="ScenarioError">${body}</error>`);
      }
      if (c.result !== undefined) {
        const lines = [`result: ${c.result}`, `ticks: ${c.ticks}`, ...c.errors];
        children.push(`      <system-out>${xmlEscape(lines.join('\n'))}</system-out>`);
      }
      if (children.length === 0) {
        out.push(`${open} />`);
      } else {
        out.push(`${open}>`, ...children, '    </testcase>');
      }
    }
    out.push('  </testsuite>');
  }
  out.push('</testsuites>');
  return `${out.join('\n')}\n`;
}
