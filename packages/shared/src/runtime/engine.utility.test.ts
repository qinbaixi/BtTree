import { describe, expect, it } from 'vitest';
import { compileProject } from '../compileProject';
import { createIdGen, nodeFromJson } from '../treeModel';
import { forEachNode } from '../treeOps';
import type { ProjectFile, SubItemJson, TreeNodeJson } from '../types';
import { combineScores, createRun, resolveCompositeKind, type TickResult } from './engine';

const projectFile: ProjectFile = {
  nodes: [
    {
      name: 'UtilitySelector',
      isComposite: true,
      properties: [
        { name: 'OnChildFailure', type: 'enum', values: ['TryNext', 'Fail'], default: 'TryNext' },
        {
          name: 'Selection',
          type: 'enum',
          values: ['Highest', 'WeightedRandom'],
          default: 'Highest',
        },
        { name: 'RandomTop', type: 'number', default: 0 },
        { name: 'MinScore', type: 'number', default: 0 },
      ],
    },
    { name: 'Chooser', isComposite: true, simulate: { composite: 'utility' } },
    { name: 'Succeed', simulate: { mode: 'success' } },
    { name: 'Fail', simulate: { mode: 'failure' } },
    {
      name: 'Wait',
      properties: [{ name: 'Duration', type: 'number', default: 2 }],
      simulate: { mode: 'rule', duration: '{{Duration}}' },
    },
  ],
  decorators: [
    {
      name: 'Utility',
      properties: [{ name: 'Score', type: 'string', default: '0.5' }],
      simulate: { score: '{{Score}}' },
    },
    {
      name: 'Consideration',
      properties: [
        { name: 'Input', type: 'string' },
        { name: 'Min', type: 'number', default: 0 },
        { name: 'Max', type: 'number', default: 100 },
        { name: 'Curve', type: 'enum', values: ['Linear', 'InverseLinear'], default: 'Linear' },
      ],
      simulate: { score: 'curve({{Curve}}, normalize(get({{Input}}), {{Min}}, {{Max}}))' },
    },
    { name: 'Cond', simulate: { condition: 'Flag' } },
  ],
};

const project = compileProject(projectFile);

const utility = (score: string, label?: string): SubItemJson => ({
  type: 'Utility',
  label,
  properties: [{ name: 'Score', value: score }],
});

const consider = (input: string, curve = 'Linear'): SubItemJson => ({
  type: 'Consideration',
  properties: [
    { name: 'Input', value: input },
    { name: 'Curve', value: curve },
  ],
});

const leaf = (type: string, label: string, decorators: SubItemJson[]): TreeNodeJson => ({
  type,
  label,
  decorators,
});

function make(json: TreeNodeJson, blackboard: Record<string, unknown> = {}, seed?: number) {
  const root = nodeFromJson(json, createIdGen());
  const ids = new Map<string, string>();
  forEachNode(root, (node) => {
    if (node.label) ids.set(node.label, node.id);
  });
  const id = (label: string) => ids.get(label)!;
  const run = createRun(root, project, { blackboard, seed });
  return {
    run,
    id,
    status: (r: TickResult, label: string) => r.statuses[id(label)],
    entered: (r: TickResult) =>
      r.log.filter((l) => l.kind === 'enter' && l.nodeId !== root.id).map((l) => l.nodeId),
  };
}

const props = (values: Record<string, unknown>) =>
  Object.entries(values).map(([name, value]) => ({ name, value }));

describe('utility composite', () => {
  it('is inferred from the type name and from simulate.composite', () => {
    expect(resolveCompositeKind(project.nodes.UtilitySelector)).toBe('utility');
    expect(resolveCompositeKind(project.nodes.Chooser)).toBe('utility');
  });

  it('runs the child with the highest score and records the scores', () => {
    const h = make({
      type: 'UtilitySelector',
      childNodes: [
        leaf('Succeed', 'low', [utility('0.2')]),
        leaf('Succeed', 'high', [utility('0.9')]),
        leaf('Succeed', 'mid', [utility('0.5')]),
      ],
    });
    const r = h.run.tick();
    expect(r.finished).toBe('success');
    expect(h.status(r, 'high')).toBe('success');
    expect(h.status(r, 'low')).toBe('idle');
    expect(r.scores).toEqual({ [h.id('low')]: 0.2, [h.id('high')]: 0.9, [h.id('mid')]: 0.5 });
    const score = r.log.find((l) => l.kind === 'score');
    expect(score?.message).toBe('scores: low 0.2, high 0.9, mid 0.5 → high');
  });

  it('scores from the blackboard through considerations and curves', () => {
    const tree: TreeNodeJson = {
      type: 'UtilitySelector',
      childNodes: [
        leaf('Succeed', 'attack', [consider('Health')]),
        leaf('Succeed', 'flee', [consider('Health', 'InverseLinear')]),
      ],
    };
    const healthy = make(tree, { Health: 80 });
    expect(healthy.status(healthy.run.tick(), 'attack')).toBe('success');
    const hurt = make(tree, { Health: 10 });
    expect(hurt.status(hurt.run.tick(), 'flee')).toBe('success');
  });

  it('multiplies several score decorators with compensation', () => {
    expect(combineScores([])).toBe(0);
    expect(combineScores([0.5])).toBe(0.5);
    // n = 2: 0.5 + 0.5 * 0.5 * 0.5 = 0.625 per factor
    expect(combineScores([0.5, 0.5])).toBeCloseTo(0.390625);
    expect(combineScores([0.5, 0])).toBe(0);
    // weights outside 0..1 are multiplied unchanged
    expect(combineScores([2, 1])).toBe(2);
  });

  it('tries the next best child after a failure (TryNext)', () => {
    const h = make({
      type: 'UtilitySelector',
      childNodes: [
        leaf('Succeed', 'second', [utility('0.5')]),
        leaf('Fail', 'first', [utility('0.9')]),
      ],
    });
    const r = h.run.tick();
    expect(h.entered(r)).toEqual([h.id('first'), h.id('second')]);
    expect(r.finished).toBe('success');
  });

  it('fails with the first child when OnChildFailure is Fail', () => {
    const h = make({
      type: 'UtilitySelector',
      properties: props({ OnChildFailure: 'Fail' }),
      childNodes: [
        leaf('Succeed', 'second', [utility('0.5')]),
        leaf('Fail', 'first', [utility('0.9')]),
      ],
    });
    const r = h.run.tick();
    expect(r.finished).toBe('failure');
    expect(h.status(r, 'second')).toBe('idle');
  });

  it('skips children without score, with score 0 or below MinScore', () => {
    const h = make({
      type: 'UtilitySelector',
      properties: props({ MinScore: 0.3 }),
      childNodes: [
        leaf('Succeed', 'none', []),
        leaf('Succeed', 'zero', [utility('0')]),
        leaf('Succeed', 'low', [utility('0.2')]),
      ],
    });
    const r = h.run.tick();
    expect(r.finished).toBe('failure');
    expect(h.entered(r)).toEqual([]);
    expect(r.log.find((l) => l.kind === 'score')?.message).toMatch(/→ none$/);
  });

  it('keeps the chosen child running until it finishes, without rescoring', () => {
    const h = make(
      {
        type: 'UtilitySelector',
        childNodes: [
          leaf('Wait', 'wait', [consider('A')]),
          leaf('Succeed', 'other', [consider('B')]),
        ],
      },
      { A: 60, B: 40 },
    );
    let r = h.run.tick();
    expect(h.status(r, 'wait')).toBe('running');
    h.run.setBlackboardValue('A', 0);
    h.run.setBlackboardValue('B', 100);
    r = h.run.tick();
    expect(h.status(r, 'wait')).toBe('running');
    expect(r.log.some((l) => l.kind === 'score')).toBe(false);
    r = h.run.tick();
    expect(h.status(r, 'wait')).toBe('success');
    expect(r.finished).toBe('success');
    expect(r.scores?.[h.id('wait')]).toBeCloseTo(0.6);
  });

  it('picks weighted at random among the best (reproducible by seed)', () => {
    const tree: TreeNodeJson = {
      type: 'UtilitySelector',
      properties: props({ Selection: 'WeightedRandom', RandomTop: 2 }),
      childNodes: [
        leaf('Succeed', 'a', [utility('0.9')]),
        leaf('Succeed', 'b', [utility('0.8')]),
        leaf('Succeed', 'c', [utility('0.1')]),
      ],
    };
    const winner = (seed: number) => {
      const h = make(tree, {}, seed);
      const r = h.run.tick();
      return ['a', 'b', 'c'].find((l) => h.status(r, l) === 'success');
    };
    const winners = new Set<string | undefined>();
    for (let seed = 1; seed <= 30; seed++) winners.add(winner(seed));
    expect(winners).toEqual(new Set(['a', 'b']));
    expect(winner(5)).toBe(winner(5));
  });

  it('logs a score error and treats the child as score 0', () => {
    const h = make({
      type: 'UtilitySelector',
      childNodes: [
        leaf('Succeed', 'bad', [utility('abc')]),
        leaf('Succeed', 'good', [utility('0.1')]),
      ],
    });
    const r = h.run.tick();
    expect(h.status(r, 'good')).toBe('success');
    expect(r.log.some((l) => l.kind === 'error' && /score must be a number/.test(l.message))).toBe(
      true,
    );
  });

  it('does not treat score decorators as conditions', () => {
    const h = make({ type: 'Succeed', decorators: [utility('0')] });
    expect(h.run.tick().finished).toBe('success');
  });

  it('restores scores with checkpoints and clears them on the next pass', () => {
    const tree: TreeNodeJson = {
      type: 'UtilitySelector',
      childNodes: [leaf('Succeed', 'only', [utility('0.7')])],
    };
    const root = nodeFromJson(tree, createIdGen());
    const run = createRun(root, project, { blackboard: {}, loops: 0 });
    const before = run.checkpoint();
    expect(run.tick().scores).toBeDefined();
    run.restore(before);
    expect(run.snapshot().scores).toBeUndefined();
  });
});
