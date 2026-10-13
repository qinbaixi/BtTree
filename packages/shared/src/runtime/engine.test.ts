import { describe, expect, it } from 'vitest';
import { compileProject } from '../compileProject';
import { createIdGen, nodeFromJson } from '../treeModel';
import { forEachNode } from '../treeOps';
import type { ProjectFile, TreeNodeJson } from '../types';
import {
  createRun,
  resolveActionMode,
  resolveCompositeKind,
  type Run,
  type TickResult,
} from './engine';

const projectFile: ProjectFile = {
  nodes: [
    { name: 'Selector', isComposite: true },
    { name: 'Sequence', isComposite: true },
    {
      name: 'Parallel',
      isComposite: true,
      properties: [{ name: 'Policy', type: 'enum', values: ['RequireAll', 'RequireOne'] }],
    },
    {
      name: 'RandomSelector',
      isComposite: true,
      properties: [{ name: 'Weights', type: 'string', default: '' }],
    },
    { name: 'MySeq', base: 'Sequence', isComposite: true },
    { name: 'Odd', isComposite: true, simulate: { composite: 'selector' } },
    { name: 'Succeed', simulate: { mode: 'success' } },
    { name: 'Fail', simulate: { mode: 'failure' } },
    { name: 'Manual' },
    {
      name: 'Wait',
      properties: [{ name: 'Duration', type: 'number', default: 2 }],
      simulate: { mode: 'rule', duration: '{{Duration}}' },
    },
    {
      name: 'Attack',
      simulate: { condition: 'Ammo > 0', effects: ['Ammo = Ammo - 1'] },
    },
    { name: 'Boom', simulate: { effects: ['X = 1 / 0'] } },
    { name: 'BadDur', simulate: { duration: 'Name' } },
    { name: 'SetFlag', simulate: { mode: 'success', effects: ['Flag = true', 'Step = Step + 1'] } },
  ],
  decorators: [
    {
      name: 'Cond',
      properties: [{ name: 'Want', type: 'bool', default: true }],
      simulate: { condition: 'Flag == {{Want}}' },
    },
    { name: 'Invert', simulate: { decorator: 'invert' } },
    { name: 'ForceSuccess', simulate: { decorator: 'forceSuccess' } },
    { name: 'ForceFailure', simulate: { decorator: 'forceFailure' } },
    {
      name: 'Loop',
      properties: [{ name: 'N', type: 'number', default: 3 }],
      simulate: { decorator: 'loop', count: '{{N}}' },
    },
    {
      name: 'Cooldown',
      properties: [{ name: 'T', type: 'number', default: 3 }],
      simulate: { decorator: 'cooldown', ticks: '{{T}}' },
    },
    {
      name: 'TimeLimit',
      properties: [{ name: 'T', type: 'number', default: 2 }],
      simulate: { decorator: 'timeLimit', ticks: '{{T}}' },
    },
    { name: 'BadCond', simulate: { condition: '1 / 0' } },
  ],
  services: [
    { name: 'Counter', simulate: { effects: ['Count = Count + 1'] } },
    { name: 'BadService', simulate: { effects: ['Q = nope('] } },
  ],
};

const project = compileProject(projectFile);

interface Harness {
  run: Run;
  id: (label: string) => string;
  statusOf: (r: TickResult, label: string) => string | undefined;
  messages: (r: TickResult) => string[];
}

interface MakeOptions {
  seed?: number;
  loops?: number;
  overrides?: (id: (label: string) => string) => Record<string, Record<string, unknown>>;
}

function make(
  json: TreeNodeJson,
  blackboard: Record<string, unknown> = {},
  extra: MakeOptions = {},
): Harness {
  const root = nodeFromJson(json, createIdGen());
  const ids = new Map<string, string>();
  forEachNode(root, (node) => {
    if (node.label) ids.set(node.label, node.id);
    for (const item of [...node.decorators, ...node.services]) {
      if (item.label) ids.set(item.label, item.id);
    }
  });
  const id = (label: string): string => {
    const found = ids.get(label);
    if (!found) throw new Error(`no label ${label}`);
    return found;
  };
  const run = createRun(root, project, {
    blackboard,
    seed: extra.seed,
    loops: extra.loops,
    overrides: extra.overrides?.(id),
  });
  return {
    run,
    id,
    statusOf: (r, label) => r.statuses[id(label)],
    messages: (r) => r.log.map((l) => l.message),
  };
}

const leaf = (type: string, label: string, extra: Partial<TreeNodeJson> = {}): TreeNodeJson => ({
  type,
  label,
  ...extra,
});

const duration = (value: number) => [{ name: 'Duration', value }];

describe('helpers', () => {
  it('resolves composite kinds from simulate, name and bases', () => {
    expect(resolveCompositeKind(project.nodes.Selector)).toBe('selector');
    expect(resolveCompositeKind(project.nodes.RandomSelector)).toBe('randomSelector');
    expect(resolveCompositeKind(project.nodes.Parallel)).toBe('parallel');
    expect(resolveCompositeKind(project.nodes.MySeq)).toBe('sequence');
    expect(resolveCompositeKind(project.nodes.Odd)).toBe('selector');
  });

  it('resolves the action mode', () => {
    expect(resolveActionMode(undefined)).toBe('manual');
    expect(resolveActionMode({})).toBe('manual');
    expect(resolveActionMode({ duration: 1 })).toBe('rule');
    expect(resolveActionMode({ effects: ['A = 1'] })).toBe('rule');
    expect(resolveActionMode({ mode: 'failure', duration: 1 })).toBe('failure');
  });

  it('inherits simulate rules field by field', () => {
    const compiled = compileProject({
      nodes: [
        { name: 'A', simulate: { mode: 'rule', duration: 2, effects: ['X = 1'] } },
        { name: 'B', base: 'A', simulate: { duration: 5 } },
      ],
    });
    expect(compiled.nodes.B.simulate).toEqual({ mode: 'rule', duration: 5, effects: ['X = 1'] });
    expect(compiled.nodes.A.simulate?.duration).toBe(2);
  });
});

describe('tick basics', () => {
  it('starts idle at tick 0 and finishes a single action', () => {
    const h = make(leaf('Succeed', 'a'));
    const initial = h.run.snapshot();
    expect(initial.tick).toBe(0);
    expect(h.statusOf(initial, 'a')).toBe('idle');
    const r = h.run.tick();
    expect(r.tick).toBe(1);
    expect(r.finished).toBe('success');
    expect(h.statusOf(r, 'a')).toBe('success');
    expect(h.messages(r)).toEqual(['started', 'success']);
  });

  it('does not progress after the run is finished', () => {
    const h = make(leaf('Fail', 'a'));
    const first = h.run.tick();
    expect(first.finished).toBe('failure');
    const again = h.run.tick();
    expect(again.tick).toBe(1);
    expect(again.log).toEqual([]);
    expect(again.finished).toBe('failure');
  });

  it('does not mutate the given initial blackboard and returns copies', () => {
    const initial = { Ammo: 2, Nested: { a: 1 } };
    const h = make(leaf('Attack', 'a'), initial);
    const r = h.run.tick();
    expect(initial.Ammo).toBe(2);
    expect(r.blackboard.Ammo).toBe(1);
    (r.blackboard.Nested as { a: number }).a = 9;
    expect(h.run.snapshot().blackboard.Nested).toEqual({ a: 1 });
  });
});

describe('sequence and selector', () => {
  it('sequence runs children in order and fails on the first failure', () => {
    const h = make({
      type: 'Sequence',
      label: 's',
      childNodes: [leaf('Succeed', 'a'), leaf('Fail', 'b'), leaf('Succeed', 'c')],
    });
    const r = h.run.tick();
    expect(r.finished).toBe('failure');
    expect(h.statusOf(r, 'a')).toBe('success');
    expect(h.statusOf(r, 'b')).toBe('failure');
    expect(h.statusOf(r, 'c')).toBe('idle');
  });

  it('sequence succeeds when all children succeed; empty sequence succeeds', () => {
    const h = make({ type: 'Sequence', childNodes: [leaf('Succeed', 'a'), leaf('Succeed', 'b')] });
    expect(h.run.tick().finished).toBe('success');
    expect(make({ type: 'Sequence' }).run.tick().finished).toBe('success');
  });

  it('selector stops at the first success; empty selector fails', () => {
    const h = make({
      type: 'Selector',
      label: 's',
      childNodes: [leaf('Fail', 'a'), leaf('Succeed', 'b'), leaf('Succeed', 'c')],
    });
    const r = h.run.tick();
    expect(r.finished).toBe('success');
    expect(h.statusOf(r, 'c')).toBe('idle');
    expect(make({ type: 'Selector' }).run.tick().finished).toBe('failure');
  });

  it('infers composites through bases and simulate.composite', () => {
    const seq = make({ type: 'MySeq', childNodes: [leaf('Fail', 'a'), leaf('Succeed', 'b')] });
    expect(seq.run.tick().finished).toBe('failure');
    const odd = make({ type: 'Odd', childNodes: [leaf('Fail', 'a'), leaf('Succeed', 'b')] });
    expect(odd.run.tick().finished).toBe('success');
  });

  it('resumes the running child (memory) instead of restarting', () => {
    const h = make(
      {
        type: 'Sequence',
        label: 's',
        childNodes: [
          leaf('SetFlag', 'first'),
          leaf('Wait', 'w', { properties: duration(2) }),
          leaf('Succeed', 'last'),
        ],
      },
      { Step: 0 },
    );
    const t1 = h.run.tick();
    expect(h.statusOf(t1, 'w')).toBe('running');
    expect(t1.blackboard.Step).toBe(1);
    const t2 = h.run.tick();
    expect(h.statusOf(t2, 'w')).toBe('running');
    expect(t2.blackboard.Step).toBe(1);
    const t3 = h.run.tick();
    expect(h.statusOf(t3, 'w')).toBe('success');
    expect(t3.finished).toBe('success');
    expect(t3.blackboard.Step).toBe(1);
  });

  it('falls through to the next selector child after a failed sequence', () => {
    const h = make({
      type: 'Selector',
      childNodes: [
        { type: 'Sequence', label: 'seq', childNodes: [leaf('Succeed', 'a'), leaf('Fail', 'b')] },
        leaf('Succeed', 'fallback'),
      ],
    });
    const r = h.run.tick();
    expect(h.statusOf(r, 'seq')).toBe('failure');
    expect(h.statusOf(r, 'fallback')).toBe('success');
    expect(r.finished).toBe('success');
  });
});

describe('parallel', () => {
  const tree = (policy?: string): TreeNodeJson => ({
    type: 'Parallel',
    label: 'p',
    ...(policy ? { properties: [{ name: 'Policy', value: policy }] } : {}),
    childNodes: [leaf('Succeed', 'quick'), leaf('Wait', 'slow', { properties: duration(2) })],
  });

  it('RequireAll (default) waits for every child', () => {
    const h = make(tree());
    const t1 = h.run.tick();
    expect(t1.finished).toBeUndefined();
    expect(h.statusOf(t1, 'quick')).toBe('success');
    expect(h.statusOf(t1, 'slow')).toBe('running');
    h.run.tick();
    expect(h.run.tick().finished).toBe('success');
  });

  it('RequireAll fails at once and aborts the running siblings', () => {
    const h = make({ type: 'Parallel', childNodes: [leaf('Wait', 'slow'), leaf('Fail', 'bad')] });
    const r = h.run.tick();
    expect(r.finished).toBe('failure');
    expect(h.statusOf(r, 'slow')).toBe('idle');
    expect(h.messages(r)).toContain('aborted');
  });

  it('RequireOne succeeds with the first success and aborts the rest', () => {
    const h = make(tree('RequireOne'));
    const r = h.run.tick();
    expect(r.finished).toBe('success');
    expect(h.statusOf(r, 'slow')).toBe('idle');
  });

  it('RequireOne fails when every child failed; empty parallel succeeds', () => {
    const h = make({
      type: 'Parallel',
      properties: [{ name: 'Policy', value: 'RequireOne' }],
      childNodes: [leaf('Fail', 'a'), leaf('Fail', 'b')],
    });
    expect(h.run.tick().finished).toBe('failure');
    expect(make({ type: 'Parallel' }).run.tick().finished).toBe('success');
  });
});

describe('random selector', () => {
  const tree: TreeNodeJson = {
    type: 'RandomSelector',
    childNodes: ['a', 'b', 'c', 'd', 'e'].map((l) => leaf('Fail', l)),
  };
  const order = (seed?: number) => {
    const h = make(tree, {}, { seed });
    const r = h.run.tick();
    return r.log.filter((l) => l.kind === 'enter').map((l) => l.nodeId);
  };

  it('is reproducible for the same seed and differs between seeds', () => {
    expect(order(7)).toEqual(order(7));
    expect(order()).toEqual(order(1));
    const orders = new Set([1, 2, 3, 4, 5, 6].map((s) => order(s).join(',')));
    expect(orders.size).toBeGreaterThan(1);
  });

  it('tries every child before failing', () => {
    expect(order(3)).toHaveLength(6);
    const h = make(tree, {}, { seed: 3 });
    expect(h.run.tick().finished).toBe('failure');
  });

  it('honours weights', () => {
    const weighted: TreeNodeJson = {
      type: 'RandomSelector',
      properties: [{ name: 'Weights', value: '0.0001, 1000' }],
      childNodes: [leaf('Succeed', 'rare'), leaf('Succeed', 'common')],
    };
    let commonFirst = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const h = make(weighted, {}, { seed });
      const r = h.run.tick();
      if (h.statusOf(r, 'common') === 'success') commonFirst++;
    }
    expect(commonFirst).toBeGreaterThan(15);
  });
});

describe('actions', () => {
  it('stays running for `duration` ticks (template from a property)', () => {
    const h = make(leaf('Wait', 'w', { properties: duration(3) }));
    expect(h.statusOf(h.run.tick(), 'w')).toBe('running');
    expect(h.statusOf(h.run.tick(), 'w')).toBe('running');
    expect(h.statusOf(h.run.tick(), 'w')).toBe('running');
    const r = h.run.tick();
    expect(h.statusOf(r, 'w')).toBe('success');
    expect(r.tick).toBe(4);
  });

  it('uses the property default when not set', () => {
    const h = make(leaf('Wait', 'w'));
    h.run.tick();
    h.run.tick();
    expect(h.run.tick().finished).toBe('success');
  });

  it('applies overrides before properties and defaults', () => {
    const h = make(
      leaf('Wait', 'w', { properties: duration(5) }),
      {},
      { overrides: (id) => ({ [id('w')]: { Duration: 0 } }) },
    );
    expect(h.run.tick().finished).toBe('success');
  });

  it('evaluates conditions and effects when the action finishes', () => {
    const h = make(leaf('Attack', 'atk'), { Ammo: 1 });
    const r = h.run.tick();
    expect(r.finished).toBe('success');
    expect(r.blackboard.Ammo).toBe(0);
    expect(h.messages(r)).toContain('Ammo: 1 → 0');
    const empty = make(leaf('Attack', 'atk'), { Ammo: 0 });
    const f = empty.run.tick();
    expect(f.finished).toBe('failure');
    expect(f.blackboard.Ammo).toBe(0);
  });

  it('runs several effects in order, logging only changes', () => {
    const h = make(leaf('SetFlag', 'f'), { Flag: true, Step: 4 });
    const r = h.run.tick();
    expect(r.blackboard).toEqual({ Flag: true, Step: 5 });
    expect(r.log.filter((l) => l.kind === 'blackboard').map((l) => l.message)).toEqual([
      'Step: 4 → 5',
    ]);
  });

  it('logs new keys as unset -> value', () => {
    const h = make(leaf('SetFlag', 'f'), { Step: 0 });
    expect(h.messages(h.run.tick())).toContain('Flag: (unset) → true');
  });

  it('turns runtime errors into a failure with an error entry', () => {
    const h = make(leaf('Boom', 'b'));
    const r = h.run.tick();
    expect(r.finished).toBe('failure');
    const error = r.log.find((l) => l.kind === 'error');
    expect(error?.message).toContain('Division by zero');
    expect(error?.nodeId).toBe(h.id('b'));
    const bad = make(leaf('BadDur', 'b'), { Name: 'x' });
    const r2 = bad.run.tick();
    expect(r2.finished).toBe('failure');
    expect(
      r2.log.some((l) => l.kind === 'error' && l.message.includes('duration must be a number')),
    ).toBe(true);
  });
});

describe('manual actions', () => {
  const tree: TreeNodeJson = {
    type: 'Sequence',
    childNodes: [leaf('Manual', 'm'), leaf('Succeed', 'after')],
  };

  it('waits for resolveManual and blocks ticking', () => {
    const h = make(tree);
    const t1 = h.run.tick();
    expect(t1.pendingManual).toBe(h.id('m'));
    expect(h.run.pendingManual()).toBe(h.id('m'));
    expect(h.statusOf(t1, 'm')).toBe('running');
    const blocked = h.run.tick();
    expect(blocked.tick).toBe(1);
    expect(blocked.pendingManual).toBe(h.id('m'));
    h.run.resolveManual(h.id('m'), 'success');
    expect(h.run.pendingManual()).toBeUndefined();
    const t2 = h.run.tick();
    expect(t2.tick).toBe(2);
    expect(h.statusOf(t2, 'm')).toBe('success');
    expect(t2.finished).toBe('success');
  });

  it('propagates a manual failure', () => {
    const h = make(tree);
    h.run.tick();
    h.run.resolveManual(h.id('m'), 'failure');
    const r = h.run.tick();
    expect(r.finished).toBe('failure');
    expect(h.statusOf(r, 'after')).toBe('idle');
  });

  it('rejects unknown nodes', () => {
    const h = make(tree);
    h.run.tick();
    expect(() => h.run.resolveManual('nope', 'success')).toThrow('not waiting');
  });

  it('queues several manual actions of a parallel node', () => {
    const h = make({ type: 'Parallel', childNodes: [leaf('Manual', 'm1'), leaf('Manual', 'm2')] });
    h.run.tick();
    expect(h.run.pendingManual()).toBe(h.id('m1'));
    h.run.resolveManual(h.id('m1'), 'success');
    expect(h.run.pendingManual()).toBe(h.id('m2'));
    expect(h.run.tick().tick).toBe(1);
    h.run.resolveManual(h.id('m2'), 'success');
    expect(h.run.tick().finished).toBe('success');
  });

  it('drops pending requests of aborted nodes', () => {
    const h = make({ type: 'Parallel', childNodes: [leaf('Manual', 'm'), leaf('Fail', 'f')] });
    const r = h.run.tick();
    expect(r.finished).toBe('failure');
    expect(r.pendingManual).toBeUndefined();
  });
});

describe('condition decorators', () => {
  const guarded = (props?: TreeNodeJson['properties']): TreeNodeJson =>
    leaf('Succeed', 'a', {
      decorators: [{ type: 'Cond', label: 'cond', properties: props }],
    });

  it('passes and fails at node start', () => {
    const pass = make(guarded(), { Flag: true });
    const r = pass.run.tick();
    expect(r.finished).toBe('success');
    expect(r.subStatuses[pass.id('cond')]).toBe('pass');
    const fail = make(guarded(), { Flag: false });
    const f = fail.run.tick();
    expect(f.finished).toBe('failure');
    expect(f.subStatuses[fail.id('cond')]).toBe('fail');
    expect(fail.statusOf(f, 'a')).toBe('failure');
    expect(fail.messages(f)).toContain('Cond: condition false → fail');
  });

  it('uses decorator property values', () => {
    const h = make(guarded([{ name: 'Want', value: false }]), { Flag: false });
    expect(h.run.tick().finished).toBe('success');
  });

  it('honours inverseCheckCondition', () => {
    const json: TreeNodeJson = leaf('Succeed', 'a', {
      decorators: [{ type: 'Cond', label: 'c', inverseCheckCondition: true }],
    });
    expect(make(json, { Flag: true }).run.tick().finished).toBe('failure');
    expect(make(json, { Flag: false }).run.tick().finished).toBe('success');
  });

  it('passes decorators without simulate rules', () => {
    const json = leaf('Succeed', 'a', { decorators: [{ type: 'Unknown' }] });
    expect(make(json).run.tick().finished).toBe('success');
  });

  it('periodic decorators abort the running node when the condition turns false', () => {
    const json: TreeNodeJson = leaf('Wait', 'w', {
      properties: duration(5),
      decorators: [{ type: 'Cond', label: 'cond', periodic: true }],
    });
    const h = make(json, { Flag: true });
    expect(h.statusOf(h.run.tick(), 'w')).toBe('running');
    h.run.setBlackboardValue('Flag', false);
    const r = h.run.tick();
    expect(r.finished).toBe('failure');
    expect(h.statusOf(r, 'w')).toBe('failure');
    expect(r.subStatuses[h.id('cond')]).toBe('fail');
  });

  it('non periodic decorators do not re-check', () => {
    const json: TreeNodeJson = leaf('Wait', 'w', {
      properties: duration(1),
      decorators: [{ type: 'Cond', label: 'cond' }],
    });
    const h = make(json, { Flag: true });
    h.run.tick();
    h.run.setBlackboardValue('Flag', false);
    expect(h.run.tick().finished).toBe('success');
  });

  it('periodic abort stops running descendants', () => {
    const json: TreeNodeJson = {
      type: 'Sequence',
      label: 'seq',
      decorators: [{ type: 'Cond', label: 'cond', periodic: true }],
      childNodes: [leaf('Wait', 'w', { properties: duration(5) })],
    };
    const h = make(json, { Flag: true });
    h.run.tick();
    h.run.setBlackboardValue('Flag', false);
    const r = h.run.tick();
    expect(h.statusOf(r, 'w')).toBe('idle');
    expect(h.statusOf(r, 'seq')).toBe('failure');
  });

  it('reports condition errors', () => {
    const json = leaf('Succeed', 'a', { decorators: [{ type: 'BadCond' }] });
    const r = make(json).run.tick();
    expect(r.finished).toBe('failure');
    expect(r.log.some((l) => l.kind === 'error')).toBe(true);
  });
});

describe('built-in decorators', () => {
  const decorated = (type: string, decorators: TreeNodeJson['decorators']) =>
    leaf(type, 'a', { decorators });

  it('invert flips the result', () => {
    expect(make(decorated('Succeed', [{ type: 'Invert' }])).run.tick().finished).toBe('failure');
    expect(make(decorated('Fail', [{ type: 'Invert' }])).run.tick().finished).toBe('success');
  });

  it('forceSuccess / forceFailure override the result', () => {
    expect(make(decorated('Fail', [{ type: 'ForceSuccess' }])).run.tick().finished).toBe('success');
    expect(make(decorated('Succeed', [{ type: 'ForceFailure' }])).run.tick().finished).toBe(
      'failure',
    );
  });

  it('applies several result decorators innermost first', () => {
    // Outer Invert, inner ForceSuccess: Fail -> success -> failure
    const json = decorated('Fail', [{ type: 'Invert' }, { type: 'ForceSuccess' }]);
    expect(make(json).run.tick().finished).toBe('failure');
  });

  it('loop repeats the body count times, one iteration per tick', () => {
    const json = leaf('SetFlag', 'f', {
      decorators: [{ type: 'Loop', properties: [{ name: 'N', value: 3 }] }],
    });
    const h = make(json, { Step: 0 });
    const t1 = h.run.tick();
    expect(t1.finished).toBeUndefined();
    expect(h.statusOf(t1, 'f')).toBe('running');
    expect(t1.blackboard.Step).toBe(1);
    expect(h.run.tick().blackboard.Step).toBe(2);
    const t3 = h.run.tick();
    expect(t3.finished).toBe('success');
    expect(t3.blackboard.Step).toBe(3);
  });

  it('loop stops at the first failure', () => {
    const json = decorated('Fail', [{ type: 'Loop' }]);
    expect(make(json).run.tick().finished).toBe('failure');
  });

  it('loop with a negative count runs forever', () => {
    const json = decorated('Succeed', [{ type: 'Loop', properties: [{ name: 'N', value: -1 }] }]);
    const h = make(json);
    for (let i = 0; i < 10; i++) {
      expect(h.run.tick().finished).toBeUndefined();
    }
  });

  it('cooldown fails a start inside the cooldown window', () => {
    const cooled = leaf('Succeed', 'c', {
      decorators: [{ type: 'Cooldown', label: 'cd', properties: [{ name: 'T', value: 3 }] }],
    });
    const json: TreeNodeJson = {
      type: 'Sequence',
      decorators: [{ type: 'Loop', properties: [{ name: 'N', value: 4 }] }],
      childNodes: [{ type: 'Selector', childNodes: [cooled, leaf('Succeed', 'fb')] }],
    };
    const h = make(json);
    const rows: Array<[string | undefined, string | undefined]> = [];
    for (let i = 0; i < 8; i++) {
      const r = h.run.tick();
      rows.push([h.statusOf(r, 'c'), h.statusOf(r, 'fb')]);
      if (r.finished) {
        expect(r.finished).toBe('success');
        break;
      }
    }
    // tick 1: iteration 1, the cooldown (3) starts. Ticks 2 and 3: still cooling down.
    // Tick 4: 3 ticks since the finish -> allowed again (iteration 4, the last one).
    expect(rows).toEqual([
      ['success', 'idle'],
      ['failure', 'success'],
      ['failure', 'success'],
      ['success', 'idle'],
    ]);
  });

  it('timeLimit fails a node that runs too long', () => {
    const slow = leaf('Wait', 'w', {
      properties: duration(5),
      decorators: [{ type: 'TimeLimit', label: 'tl', properties: [{ name: 'T', value: 2 }] }],
    });
    const h = make(slow);
    expect(h.statusOf(h.run.tick(), 'w')).toBe('running');
    expect(h.statusOf(h.run.tick(), 'w')).toBe('running');
    const r = h.run.tick();
    expect(r.finished).toBe('failure');
    expect(r.subStatuses[h.id('tl')]).toBe('fail');
    expect(h.messages(r)).toContain('TimeLimit: time limit reached');
  });

  it('timeLimit lets a node finish within the limit', () => {
    const quick = leaf('Wait', 'w', {
      properties: duration(2),
      decorators: [{ type: 'TimeLimit', properties: [{ name: 'T', value: 2 }] }],
    });
    const h = make(quick);
    h.run.tick();
    h.run.tick();
    expect(h.run.tick().finished).toBe('success');
  });

  it('timeLimit aborts running descendants', () => {
    const json: TreeNodeJson = {
      type: 'Sequence',
      decorators: [{ type: 'TimeLimit', properties: [{ name: 'T', value: 1 }] }],
      childNodes: [leaf('Wait', 'w', { properties: duration(9) })],
    };
    const h = make(json);
    h.run.tick();
    const r = h.run.tick();
    expect(r.finished).toBe('failure');
    expect(h.statusOf(r, 'w')).toBe('idle');
  });
});

describe('services', () => {
  const owner = (service: Record<string, unknown>): TreeNodeJson => ({
    type: 'Wait',
    label: 'w',
    properties: duration(5),
    services: [{ type: 'Counter', label: 'svc', ...service }],
  });

  it('runs every tick by default, starting with the first tick of the node', () => {
    const h = make(owner({}), { Count: 0 });
    expect(h.run.tick().blackboard.Count).toBe(1);
    expect(h.run.tick().blackboard.Count).toBe(2);
    const r = h.run.tick();
    expect(r.blackboard.Count).toBe(3);
    expect(r.subStatuses[h.id('svc')]).toBe('ran');
  });

  it('respects timeBetweenTicks and firstTickTime', () => {
    const h = make(owner({ timeBetweenTicks: 2, firstTickTime: 1 }), { Count: 0 });
    const counts: unknown[] = [];
    const ran: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      const r = h.run.tick();
      counts.push(r.blackboard.Count);
      ran.push(r.subStatuses[h.id('svc')] === 'ran');
    }
    expect(counts).toEqual([0, 1, 1, 2, 2, 3]);
    expect(ran).toEqual([false, true, false, true, false, true]);
  });

  it('only runs while the owner is running', () => {
    const h = make(
      { type: 'Sequence', childNodes: [leaf('Succeed', 'a'), owner({})] },
      { Count: 0 },
    );
    expect(h.run.tick().blackboard.Count).toBe(1);
    for (let i = 0; i < 4; i++) h.run.tick();
    const end = h.run.tick();
    expect(end.finished).toBe('success');
    expect(end.blackboard.Count).toBe(6);
    expect(h.run.tick().blackboard.Count).toBe(6);
  });

  it('does not run when a decorator stops the node from starting', () => {
    const json = { ...owner({}), decorators: [{ type: 'Cond' }] };
    const h = make(json, { Count: 0, Flag: false });
    expect(h.run.tick().blackboard.Count).toBe(0);
  });

  it('logs service errors without failing the node', () => {
    const json: TreeNodeJson = {
      type: 'Wait',
      label: 'w',
      properties: duration(0),
      services: [{ type: 'BadService' }],
    };
    const r = make(json).run.tick();
    expect(r.finished).toBe('success');
    expect(r.log.some((l) => l.kind === 'error')).toBe(true);
  });

  it('clears the ran marker on ticks the service does not run', () => {
    const h = make(owner({ timeBetweenTicks: 2 }), { Count: 0 });
    expect(h.run.tick().subStatuses[h.id('svc')]).toBe('ran');
    expect(h.run.tick().subStatuses[h.id('svc')]).toBeUndefined();
  });
});

describe('blackboard editing', () => {
  it('applies live edits to following ticks', () => {
    const h = make(leaf('Attack', 'a'), { Ammo: 0 });
    h.run.setBlackboardValue('Ammo', 2);
    expect(h.run.snapshot().blackboard.Ammo).toBe(2);
    expect(h.run.tick().finished).toBe('success');
    h.run.removeBlackboardKey('Ammo');
    expect(h.run.snapshot().blackboard).toEqual({});
  });
});

describe('determinism', () => {
  it('produces identical histories for identical inputs', () => {
    const json: TreeNodeJson = {
      type: 'RandomSelector',
      childNodes: [
        leaf('Wait', 'a', { properties: duration(1) }),
        leaf('Fail', 'b'),
        leaf('Attack', 'c'),
      ],
    };
    const play = () => {
      const h = make(json, { Ammo: 2 }, { seed: 42 });
      const history: TickResult[] = [];
      for (let i = 0; i < 6; i++) history.push(h.run.tick());
      return JSON.stringify(
        history.map((r) => [r.statuses, r.log.map((l) => l.message), r.blackboard]),
      );
    };
    expect(play()).toBe(play());
  });
});

describe('looped runs', () => {
  const pass = (r: TickResult) => `${r.pass}/${r.passes}`;

  it('loops=1 (default) behaves like a single run', () => {
    const h = make(leaf('Succeed', 'a'));
    const r = h.run.tick();
    expect(r.finished).toBe('success');
    expect(pass(r)).toBe('1/1');
    expect(r.passResult).toBeUndefined();
    expect(r.log.some((l) => l.kind === 'pass')).toBe(false);
    expect(make(leaf('Succeed', 'a'), {}, { loops: 1 }).run.tick().log).toEqual(r.log);
  });

  it('runs exactly N passes and finishes with the last result', () => {
    const h = make(leaf('Attack', 'a'), { Ammo: 2 }, { loops: 3 });
    const first = h.run.tick();
    expect(first.finished).toBeUndefined();
    expect(first.passResult).toBe('success');
    expect(pass(first)).toBe('1/3');
    expect(h.messages(first)).toContain('Run 1/3 finished: Success');
    const second = h.run.tick();
    expect(second.finished).toBeUndefined();
    expect(pass(second)).toBe('2/3');
    expect(h.messages(second)).toContain('Run 2/3 started');
    const third = h.run.tick();
    expect(pass(third)).toBe('3/3');
    expect(third.finished).toBe('failure');
    expect(h.messages(third)).toContain('Run 3/3 started');
    expect(h.messages(third)).toContain('Run 3/3 finished: Failure');
    const after = h.run.tick();
    expect(after.tick).toBe(3);
    expect(after.log).toEqual([]);
    expect(after.finished).toBe('failure');
  });

  it('keeps going with loops=0', () => {
    const h = make(leaf('Succeed', 'a'), {}, { loops: 0 });
    let r = h.run.snapshot();
    for (let i = 0; i < 100; i++) r = h.run.tick();
    expect(r.tick).toBe(100);
    expect(r.finished).toBeUndefined();
    expect(r.pass).toBe(100);
    expect(r.passes).toBe(0);
    expect(h.messages(r)).toContain('Run 100/∞ finished: Success');
  });

  it('keeps the blackboard and the tick counter across passes', () => {
    const h = make(leaf('SetFlag', 'a'), { Step: 0 }, { loops: 3 });
    const steps = [h.run.tick(), h.run.tick(), h.run.tick()].map((r) => r.blackboard.Step);
    expect(steps).toEqual([1, 2, 3]);
    expect(h.run.snapshot().tick).toBe(3);
  });

  it('resets node memory, durations and loop decorators for every pass', () => {
    const json: TreeNodeJson = {
      type: 'Sequence',
      label: 's',
      childNodes: [
        leaf('Wait', 'w', { properties: duration(1) }),
        leaf('Succeed', 'x', {
          decorators: [{ type: 'Loop', properties: [{ name: 'N', value: 2 }] }],
        }),
      ],
    };
    const h = make(json, {}, { loops: 2 });
    const perPass: number[] = [];
    let ticks = 0;
    let r: TickResult;
    do {
      r = h.run.tick();
      ticks++;
      if (r.passResult) {
        perPass.push(ticks);
        ticks = 0;
      }
    } while (!r.finished);
    expect(perPass).toHaveLength(2);
    expect(perPass[0]).toBe(perPass[1]);
    expect(h.statusOf(r, 'w')).toBe('success');
    // the first tick of a new pass shows idle statuses except the nodes running now
    const again = make(json, {}, { loops: 2 });
    while (!again.run.tick().passResult);
    const start = again.run.tick();
    expect(again.statusOf(start, 'x')).toBe('idle');
    expect(again.statusOf(start, 'w')).toBe('running');
  });

  it('keeps cooldowns across passes', () => {
    const json = leaf('Succeed', 'a', { decorators: [{ type: 'Cooldown' }] });
    const h = make(json, {}, { loops: 2 });
    expect(h.run.tick().finished).toBeUndefined();
    const second = h.run.tick();
    expect(second.finished).toBe('failure');
    expect(h.messages(second).some((m) => m.includes('cooling down'))).toBe(true);
  });

  it('keeps manual nodes pending across passes', () => {
    const h = make(leaf('Manual', 'm'), {}, { loops: 2 });
    expect(h.run.tick().pendingManual).toBe(h.id('m'));
    h.run.resolveManual(h.id('m'), 'success');
    const done = h.run.tick();
    expect(done.passResult).toBe('success');
    const next = h.run.tick();
    expect(next.pass).toBe(2);
    expect(next.pendingManual).toBe(h.id('m'));
  });

  it('makes the current pass the last one when lowered below it', () => {
    const h = make(leaf('Wait', 'w', { properties: duration(1) }), {}, { loops: 5 });
    h.run.tick();
    h.run.tick();
    expect(h.run.tick().pass).toBe(2);
    h.run.setLoops(1);
    expect(h.run.snapshot().passes).toBe(2);
    const r = h.run.tick();
    expect(r.pass).toBe(2);
    expect(r.finished).toBe('success');
    expect(h.messages(r)).toContain('Run 2/2 finished: Success');
  });

  it('finishes at once when lowered after a pass has ended', () => {
    const h = make(leaf('Succeed', 'a'), {}, { loops: 5 });
    h.run.tick();
    h.run.setLoops(1);
    expect(h.run.snapshot().finished).toBe('success');
    expect(h.run.tick().tick).toBe(1);
  });

  it('can switch to endless', () => {
    const h = make(leaf('Succeed', 'a'), {}, { loops: 2 });
    h.run.tick();
    h.run.setLoops(0);
    h.run.tick();
    expect(h.run.tick().finished).toBeUndefined();
  });
});
