import { describe, expect, it } from 'vitest';
import { createIdGen, nodeFromJson, type LogEntry, type TickResult } from '@owlbt/shared';
import {
  buildDepthMap,
  clampLogHeight,
  entryParts,
  isDecoratorFail,
  nodeDepth,
  parseBlackboardMessage,
  resultTone,
  summarizeTick,
} from './runHelpers';

const root = nodeFromJson(
  {
    type: 'Sequence',
    label: 'Main',
    childNodes: [
      {
        type: 'Attack',
        services: [{ type: 'Scan', label: 'scanner' }],
        childNodes: [{ type: 'Ask' }],
      },
      { type: 'Wait' },
    ],
  },
  createIdGen(),
);
const attack = root.childNodes[0];
const ask = attack.childNodes[0];
const wait = root.childNodes[1];

const tick = (n: number, log: LogEntry[]): TickResult => ({
  tick: n,
  pass: 1,
  passes: 1,
  statuses: {},
  subStatuses: {},
  blackboard: {},
  log,
});

const entry = (kind: LogEntry['kind'], message: string, nodeId = attack.id): LogEntry => ({
  tick: 1,
  nodeId,
  message,
  kind,
});

describe('summarizeTick', () => {
  it('finds the deepest running nodes, several for parallel branches', () => {
    const statuses = {
      [root.id]: 'running',
      [attack.id]: 'running',
      [ask.id]: 'running',
      [wait.id]: 'running',
    } as TickResult['statuses'];
    const t = { ...tick(1, []), statuses };
    expect(summarizeTick(t, root).activeNodes).toEqual([ask.id, wait.id]);
    const parentOnly = { ...t, statuses: { [root.id]: 'running' } as TickResult['statuses'] };
    expect(summarizeTick(parentOnly, root).activeNodes).toEqual([root.id]);
    expect(summarizeTick(tick(1, []), root).activeNodes).toEqual([]);
    expect(summarizeTick(t, undefined).activeNodes).toEqual([]);
  });

  it('collects blackboard changes, counters, finish and manual state', () => {
    const t: TickResult = {
      ...tick(1, [
        entry('blackboard', 'Ammo: 2 → 1'),
        entry('blackboard', 'Ammo: 1 → 0'),
        entry('blackboard', 'Enemy: true → false'),
        entry('decorator', 'HasEnemy: condition false → fail'),
        entry('decorator', 'Invert: success → failure'),
        entry('decorator', 'Limit: time limit reached'),
        entry('error', 'boom'),
      ]),
      finished: 'failure',
      pendingManual: attack.id,
    };
    expect(summarizeTick(t, root)).toEqual({
      activeNodes: [],
      finished: 'failure',
      bbChanges: [
        { key: 'Ammo', from: '2', to: '0' },
        { key: 'Enemy', from: 'true', to: 'false' },
      ],
      errors: 1,
      decoratorFails: 2,
      manualPending: attack.id,
    });
  });
});

describe('log message helpers', () => {
  it('parses blackboard messages and classifies results', () => {
    expect(parseBlackboardMessage('Ammo: 1 → 0')).toEqual({ key: 'Ammo', from: '1', to: '0' });
    expect(parseBlackboardMessage('started')).toBeUndefined();
    expect(isDecoratorFail('X: condition true (inverted) → fail')).toBe(true);
    expect(isDecoratorFail('X: condition true → pass')).toBe(false);
    expect(isDecoratorFail('Invert: success → failure')).toBe(false);
    expect(resultTone('success')).toBe('success');
    expect(resultTone('failure')).toBe('failure');
    expect(resultTone('aborted')).toBe('neutral');
    expect(resultTone('condition false')).toBe('failure');
  });
});

describe('depth and layout helpers', () => {
  it('computes node depths', () => {
    expect(nodeDepth(root, root.id)).toBe(0);
    expect(nodeDepth(root, attack.id)).toBe(1);
    expect(nodeDepth(root, ask.id)).toBe(2);
    expect(nodeDepth(root, 'nope')).toBe(0);
    expect(buildDepthMap(root).get(wait.id)).toBe(1);
    expect(buildDepthMap(undefined).size).toBe(0);
  });

  it('names the parts of an entry', () => {
    expect(entryParts(root, entry('enter', 'started', root.id))).toEqual({
      name: 'Main',
      type: 'Sequence',
    });
    expect(entryParts(root, { ...entry('service', 'x'), itemId: attack.services[0].id })).toEqual({
      name: 'Attack',
      item: 'scanner',
    });
    expect(entryParts(root, entry('error', 'x', 'zz'))).toEqual({ name: 'zz' });
  });

  it('clamps the log height between 120px and 70% of the area', () => {
    expect(clampLogHeight(50, 1000)).toBe(120);
    expect(clampLogHeight(900, 1000)).toBe(700);
    expect(clampLogHeight(300, 1000)).toBe(300);
    expect(clampLogHeight(300, 100)).toBe(120);
    expect(clampLogHeight(Number.NaN, 1000)).toBe(240);
  });
});
