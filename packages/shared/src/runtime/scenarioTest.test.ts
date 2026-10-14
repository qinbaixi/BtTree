import { describe, expect, it } from 'vitest';
import { compileProject } from '../compileProject';
import { validateProjectFile } from '../projectEdit';
import { createIdGen, nodeFromJson } from '../treeModel';
import type { ProjectFile, ScenarioJson, TreeNodeJson } from '../types';
import {
  compareBlackboard,
  DEFAULT_SCENARIO_MAX_TICKS,
  globToRegExp,
  jsonEqual,
  runScenarioTest,
  scenarioAppliesTo,
  scenarioMaxTicks,
  validateScenarioTestFields,
} from './scenarioTest';

const file: ProjectFile = {
  nodes: [
    { name: 'Sequence', isComposite: true },
    { name: 'Selector', isComposite: true },
    {
      name: 'Shoot',
      simulate: { mode: 'rule', duration: 1, condition: 'Ammo > 0', effects: ['Ammo = Ammo - 1'] },
    },
    { name: 'Say', simulate: { mode: 'success', effects: ['Said = true'] } },
    { name: 'Ask' },
    { name: 'Forever', simulate: { mode: 'rule', duration: 100000 } },
    { name: 'Broken', simulate: { mode: 'rule', condition: 'Ammo >' } },
  ],
};
const project = compileProject(file);

function tree(json: TreeNodeJson) {
  return nodeFromJson(json, createIdGen());
}

const shootTwice = tree({ type: 'Sequence', childNodes: [{ type: 'Shoot' }, { type: 'Shoot' }] });

function scenario(extra: Partial<ScenarioJson>): ScenarioJson {
  return { name: 'S', blackboard: { Ammo: 2 }, ...extra };
}

describe('runScenarioTest', () => {
  it('reports the result without expectations', () => {
    const outcome = runScenarioTest(shootTwice, project, scenario({}));
    expect(outcome.status).toBe('ran');
    expect(outcome.result).toBe('success');
    expect(outcome.ticks).toBe(3);
    expect(outcome.blackboard).toEqual({ Ammo: 0 });
    expect(outcome.failures).toEqual([]);
  });

  it('passes when every expectation holds', () => {
    const outcome = runScenarioTest(
      shootTwice,
      project,
      scenario({ expect: { result: 'success', ticks: 3, blackboard: { Ammo: 0, Missing: null } } }),
    );
    expect(outcome.status).toBe('pass');
  });

  it('lists every unmet expectation', () => {
    const outcome = runScenarioTest(
      shootTwice,
      project,
      scenario({
        blackboard: { Ammo: 1 },
        expect: { result: 'success', ticks: 2, blackboard: { Ammo: 1, Other: 'x' } },
      }),
    );
    expect(outcome.status).toBe('fail');
    expect(outcome.result).toBe('failure');
    expect(outcome.failures).toEqual([
      'expected success, got failure',
      'expected 2 ticks, took 3',
      'blackboard Ammo: expected 1, got 0',
      'blackboard Other: expected "x", got (unset)',
    ]);
    expect(outcome.mismatches).toEqual([
      { key: 'Ammo', expected: 1, actual: 0 },
      { key: 'Other', expected: 'x', actual: undefined },
    ]);
  });

  it('stops at maxTicks and fails an expecting scenario that did not finish', () => {
    const forever = tree({ type: 'Forever' });
    const noResult = runScenarioTest(forever, project, scenario({ maxTicks: 5, expect: {} }));
    expect(noResult.result).toBe('running');
    expect(noResult.ticks).toBe(5);
    expect(noResult.failures).toEqual(['the tree did not finish within 5 ticks']);

    const success = runScenarioTest(
      forever,
      project,
      scenario({ maxTicks: 5, expect: { result: 'success' } }),
    );
    expect(success.failures).toEqual([
      'expected success, but the tree did not finish within 5 ticks',
    ]);

    const running = runScenarioTest(
      forever,
      project,
      scenario({ maxTicks: 5, expect: { result: 'running' } }),
    );
    expect(running.status).toBe('pass');
  });

  it('resolves manual actions with the scenario manual result', () => {
    const root = tree({ type: 'Sequence', childNodes: [{ type: 'Ask' }, { type: 'Say' }] });
    const ok = runScenarioTest(root, project, scenario({ expect: { result: 'success' } }));
    expect(ok.status).toBe('pass');
    expect(ok.manualResolved).toBe(1);
    expect(ok.blackboard.Said).toBe(true);

    const failed = runScenarioTest(root, project, scenario({ manual: 'failure' }));
    expect(failed.result).toBe('failure');
  });

  it('collects engine errors', () => {
    const outcome = runScenarioTest(tree({ type: 'Broken' }), project, scenario({}));
    expect(outcome.result).toBe('failure');
    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0]).toMatch(/^tick 1: /);
  });

  it('is deterministic for a seed', () => {
    const a = runScenarioTest(shootTwice, project, scenario({ seed: 7 }));
    const b = runScenarioTest(shootTwice, project, scenario({ seed: 7 }));
    expect(a).toEqual(b);
  });
});

describe('helpers', () => {
  it('compares JSON values deeply', () => {
    expect(jsonEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(jsonEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(jsonEqual([1], { 0: 1 })).toBe(false);
    expect(jsonEqual(1, '1')).toBe(false);
    expect(compareBlackboard({ a: null }, {})).toEqual([]);
    expect(compareBlackboard({ a: 0 }, {})).toEqual([{ key: 'a', expected: 0, actual: undefined }]);
  });

  it('matches globs', () => {
    expect(globToRegExp('trees/*.json').test('trees/a.json')).toBe(true);
    expect(globToRegExp('trees/*.json').test('trees/sub/a.json')).toBe(false);
    expect(globToRegExp('trees/**/*.json').test('trees/a.json')).toBe(true);
    expect(globToRegExp('trees/**/*.json').test('trees/sub/a.json')).toBe(true);
    expect(globToRegExp('**').test('x/y.json')).toBe(true);
    expect(globToRegExp('./a?.json').test('ab.json')).toBe(true);
    expect(globToRegExp('a(1).json').test('a(1).json')).toBe(true);
  });

  it('selects the trees of a scenario', () => {
    expect(scenarioAppliesTo(scenario({}), 'any.json')).toBe(true);
    expect(scenarioAppliesTo(scenario({ trees: 'trees/a.json' }), 'trees/a.json')).toBe(true);
    expect(scenarioAppliesTo(scenario({ trees: ['x.json', 'trees/*'] }), 'trees/b.json')).toBe(
      true,
    );
    expect(scenarioAppliesTo(scenario({ trees: ['x.json'] }), 'trees/b.json')).toBe(false);
  });

  it('uses the default tick budget for missing or invalid maxTicks', () => {
    expect(scenarioMaxTicks(scenario({}))).toBe(DEFAULT_SCENARIO_MAX_TICKS);
    expect(scenarioMaxTicks(scenario({ maxTicks: 0 }))).toBe(DEFAULT_SCENARIO_MAX_TICKS);
    expect(scenarioMaxTicks(scenario({ maxTicks: 12 }))).toBe(12);
  });
});

describe('validateScenarioTestFields', () => {
  it('accepts a complete scenario', () => {
    expect(
      validateScenarioTestFields(
        scenario({
          trees: ['trees/*.json'],
          maxTicks: 50,
          seed: 3,
          manual: 'failure',
          expect: { result: 'running', ticks: 50, blackboard: { a: 1 } },
        }),
      ),
    ).toEqual([]);
  });

  it('reports invalid fields', () => {
    const bad = {
      name: 'S',
      blackboard: {},
      trees: [''],
      maxTicks: 1.5,
      seed: 'x',
      manual: 'maybe',
      expect: { result: 'win', ticks: -1, blackboard: [] },
    } as unknown as ScenarioJson;
    expect(validateScenarioTestFields(bad).map((issue) => issue.field)).toEqual([
      'trees',
      'maxTicks',
      'seed',
      'manual',
      'expect.result',
      'expect.ticks',
      'expect.blackboard',
    ]);
    expect(
      validateScenarioTestFields({ name: 'S', blackboard: {}, expect: [] } as never)[0].field,
    ).toBe('expect');
  });

  it('reports expect.ticks above maxTicks', () => {
    const issues = validateScenarioTestFields(scenario({ maxTicks: 5, expect: { ticks: 6 } }));
    expect(issues).toEqual([expect.objectContaining({ field: 'expect.ticks', severity: 'error' })]);
  });

  it('is part of validateProjectFile', () => {
    const issues = validateProjectFile({
      scenarios: [{ name: 'A', blackboard: {}, expect: { result: 'nope' } } as never],
    });
    expect(issues).toEqual([
      {
        path: 'scenarios[0].expect.result',
        message: "expect.result must be 'success', 'failure' or 'running'",
        severity: 'error',
      },
    ]);
  });
});
