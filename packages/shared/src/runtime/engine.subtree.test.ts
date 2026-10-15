import { describe, expect, it } from 'vitest';
import { compileProject } from '../compileProject';
import type { SubtreeLibrary } from '../subtree';
import { createIdGen, nodeFromJson } from '../treeModel';
import type { TreeNodeJson } from '../types';
import { createRun } from './engine';

const project = compileProject({
  nodes: [
    { name: 'Sequence', isComposite: true },
    { name: 'Selector', isComposite: true },
    { name: 'Inc', simulate: { mode: 'success', effects: ['Count = Count + 1'] } },
    { name: 'Check', simulate: { condition: 'Count >= 2' } },
    { name: 'Wait', simulate: { mode: 'success', duration: 1 } },
    { name: 'Manual' },
    { name: 'SubTree', subtree: true },
  ],
  decorators: [{ name: 'Invert', simulate: { decorator: 'invert' } }],
});

const ref = (path: string, extra: Partial<TreeNodeJson> = {}): TreeNodeJson => ({
  type: 'SubTree',
  label: `ref ${path}`,
  properties: [{ name: 'Tree', value: path }],
  ...extra,
});

const library: SubtreeLibrary = {
  'trees/inc.json': { tree: { type: 'Sequence', childNodes: [{ type: 'Inc' }, { type: 'Inc' }] } },
  'trees/nested.json': {
    tree: { type: 'Sequence', childNodes: [ref('trees/inc.json'), { type: 'Check' }] },
  },
  'trees/slow.json': { tree: { type: 'Sequence', childNodes: [{ type: 'Wait' }] } },
  'trees/manual.json': { tree: { type: 'Manual', label: 'Ask' } },
  'trees/self.json': { tree: { type: 'Sequence', childNodes: [ref('trees/self.json')] } },
  'trees/a.json': { tree: ref('trees/b.json') },
  'trees/b.json': { tree: ref('trees/a.json') },
};

function runOf(json: TreeNodeJson, treeRef?: string) {
  const root = nodeFromJson(json, createIdGen());
  return {
    root,
    run: createRun(root, project, {
      blackboard: { Count: 0 },
      subtrees: library,
      treeRef,
    }),
  };
}

function runToEnd(run: ReturnType<typeof createRun>) {
  let result = run.tick();
  for (let i = 0; i < 50 && !result.finished; i++) {
    result = run.tick();
  }
  return result;
}

describe('run mode with subtrees', () => {
  it('runs the referenced tree as the child of the subtree node, sharing the blackboard', () => {
    const { root, run } = runOf({
      type: 'Sequence',
      childNodes: [ref('trees/nested.json'), { type: 'Check' }],
    });
    const result = runToEnd(run);
    expect(result.finished).toBe('success');
    expect(result.blackboard.Count).toBe(2);
    const subNode = root.childNodes[0];
    expect(result.statuses[subNode.id]).toBe('success');
    // Nodes of the referenced trees get statuses under ids of the subtree node.
    expect(result.statuses[`${subNode.id}/1`]).toBe('success');
    expect(run.root.childNodes[0].childNodes[0].id).toBe(`${subNode.id}/1`);
  });

  it('logs entering the subtree', () => {
    const { root, run } = runOf({ type: 'Sequence', childNodes: [ref('trees/inc.json')] });
    const result = run.tick();
    const entries = result.log.filter((entry) => entry.nodeId === root.childNodes[0].id);
    expect(entries.map((entry) => entry.message)).toEqual([
      'started',
      'entering subtree trees/inc.json',
      'success',
    ]);
  });

  it('applies decorators of the subtree node to the result of the referenced tree', () => {
    const { run } = runOf(ref('trees/inc.json', { decorators: [{ type: 'Invert' }] }));
    expect(runToEnd(run).finished).toBe('failure');
  });

  it('keeps running subtrees and manual actions inside them', () => {
    const slow = runOf(ref('trees/slow.json'));
    expect(slow.run.tick().finished).toBeUndefined();
    expect(runToEnd(slow.run).finished).toBe('success');

    const manual = runOf(ref('trees/manual.json'));
    const first = manual.run.tick();
    expect(first.pendingManual).toBe(`${manual.root.id}/1`);
    manual.run.resolveManual(`${manual.root.id}/1`, 'failure');
    expect(manual.run.tick().finished).toBe('failure');
  });

  it('fails subtree nodes that form a cycle instead of recursing forever', () => {
    const self = runOf(ref('trees/self.json'));
    const result = runToEnd(self.run);
    expect(result.finished).toBe('failure');
    expect(result.log.filter((e) => e.kind === 'error').map((e) => e.message)).toEqual([
      'Subtree cycle: trees/self.json → trees/self.json',
    ]);

    const pair = runOf(ref('trees/a.json'));
    const errors = runToEnd(pair.run).log.filter((e) => e.kind === 'error');
    expect(errors.map((e) => e.message)).toEqual([
      'Subtree cycle: trees/a.json → trees/b.json → trees/a.json',
    ]);

    // The open tree itself is part of the chain.
    const back = runOf(
      { type: 'Sequence', childNodes: [ref('trees/main.json')] },
      'trees/main.json',
    );
    expect(runToEnd(back.run).log.find((e) => e.kind === 'error')?.message).toBe(
      'Subtree cycle: trees/main.json → trees/main.json',
    );
  });

  it('fails subtree nodes whose tree is missing or not given', () => {
    const missing = runOf({
      type: 'Selector',
      childNodes: [ref('trees/none.json'), { type: 'SubTree' }],
    });
    const result = runToEnd(missing.run);
    expect(result.finished).toBe('failure');
    expect(result.log.filter((e) => e.kind === 'error').map((e) => e.message)).toEqual([
      "Referenced tree 'trees/none.json' is not loaded",
      'No tree referenced',
    ]);
  });

  it('restores checkpoints of runs with subtrees', () => {
    const { run } = runOf(ref('trees/slow.json'));
    run.tick();
    const checkpoint = run.checkpoint();
    const finished = runToEnd(run);
    run.restore(checkpoint);
    expect(runToEnd(run)).toEqual(finished);
  });
});
