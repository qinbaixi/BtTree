import { describe, expect, it } from 'vitest';
import { createIdGen, nodeFromJson, type LogEntry, type TickResult } from '@owlbt/shared';
import {
  collectLog,
  convertValue,
  entryDisplayName,
  inferValueType,
  nodeDisplayName,
  parseValueInput,
  selectionForEntry,
  statusLabel,
} from './runHelpers';

const root = nodeFromJson(
  {
    type: 'Sequence',
    label: 'Main',
    childNodes: [
      {
        type: 'Attack',
        decorators: [{ type: 'HasEnemy' }],
        services: [{ type: 'Scan', label: 'scanner' }],
      },
    ],
  },
  createIdGen(),
);
const attack = root.childNodes[0];

const tick = (n: number, log: LogEntry[]): TickResult => ({
  tick: n,
  pass: 1,
  passes: 1,
  statuses: {},
  subStatuses: {},
  blackboard: {},
  log,
});

describe('value helpers', () => {
  it('infers and converts value types', () => {
    expect(inferValueType(1)).toBe('number');
    expect(inferValueType(true)).toBe('boolean');
    expect(inferValueType(null)).toBe('null');
    expect(inferValueType('x')).toBe('string');
    expect(inferValueType({ a: 1 })).toBe('string');
    expect(convertValue('12', 'number')).toBe(12);
    expect(convertValue('abc', 'number')).toBe(0);
    expect(convertValue(3, 'string')).toBe('3');
    expect(convertValue(null, 'string')).toBe('');
    expect(convertValue('true', 'boolean')).toBe(true);
    expect(convertValue(0, 'boolean')).toBe(false);
    expect(convertValue(5, 'null')).toBeNull();
  });

  it('parses value input', () => {
    expect(parseValueInput('4.5', 'number')).toBe(4.5);
    expect(parseValueInput('', 'number')).toBeUndefined();
    expect(parseValueInput('-', 'number')).toBeUndefined();
    expect(parseValueInput('abc', 'string')).toBe('abc');
  });
});

describe('log helpers', () => {
  it('names nodes and items', () => {
    expect(nodeDisplayName(root, root.id)).toBe('Main (Sequence)');
    expect(nodeDisplayName(root, attack.id)).toBe('Attack');
    expect(nodeDisplayName(root, 'nope')).toBe('nope');
    const entry: LogEntry = {
      tick: 1,
      nodeId: attack.id,
      itemId: attack.services[0].id,
      message: 'x',
      kind: 'service',
    };
    expect(entryDisplayName(root, entry)).toBe('Attack / scanner');
    expect(entryDisplayName(root, { ...entry, itemId: undefined })).toBe('Attack');
  });

  it('maps entries to selections', () => {
    const base: LogEntry = { tick: 1, nodeId: attack.id, message: '', kind: 'enter' };
    expect(selectionForEntry(root, base)).toEqual({ kind: 'node', nodeId: attack.id });
    expect(selectionForEntry(root, { ...base, itemId: attack.decorators[0].id })).toEqual({
      kind: 'decorator',
      nodeId: attack.id,
      itemId: attack.decorators[0].id,
    });
    expect(selectionForEntry(root, { ...base, itemId: attack.services[0].id })?.kind).toBe(
      'service',
    );
    expect(selectionForEntry(root, { ...base, nodeId: 'zz' })).toBeUndefined();
  });

  it('collects the log up to the viewed tick, filtered by kind', () => {
    const a: LogEntry = { tick: 1, nodeId: 'x', message: 'a', kind: 'enter' };
    const b: LogEntry = { tick: 1, nodeId: 'x', message: 'b', kind: 'result' };
    const c: LogEntry = { tick: 2, nodeId: 'x', message: 'c', kind: 'result' };
    const history = [tick(0, []), tick(1, [a, b]), tick(2, [c])];
    expect(collectLog(history, 2, new Set(['enter', 'result'])).map((e) => e.message)).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(collectLog(history, 1, new Set(['result'])).map((e) => e.message)).toEqual(['b']);
    expect(collectLog(history, 0, new Set(['result']))).toEqual([]);
  });

  it('labels the run status', () => {
    expect(statusLabel(undefined)).toBe('Ready');
    expect(statusLabel(tick(0, []))).toBe('Ready');
    expect(statusLabel(tick(1, []))).toBe('Running');
    expect(statusLabel({ ...tick(2, []), finished: 'success' })).toBe('Success');
    expect(statusLabel({ ...tick(2, []), finished: 'failure' })).toBe('Failure');
    expect(statusLabel({ ...tick(2, []), pendingManual: 'n1' })).toBe('Waiting for manual result');
  });
});
