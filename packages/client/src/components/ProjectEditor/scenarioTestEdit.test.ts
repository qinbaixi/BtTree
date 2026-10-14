import { describe, expect, it } from 'vitest';
import type { ScenarioJson } from '@owlbt/shared';
import { formatTrees, parseNumberField, parseTrees, withExpectField } from './scenarioTestEdit';

describe('scenarioTestEdit', () => {
  it('parses number fields', () => {
    expect(parseNumberField(' 12 ')).toBe(12);
    expect(parseNumberField('1.5')).toBe(1.5);
    expect(parseNumberField('')).toBeUndefined();
    expect(parseNumberField('abc')).toBeNull();
  });

  it('changes one expect field and keeps unknown ones', () => {
    const scenario = {
      name: 'A',
      blackboard: {},
      expect: { result: 'success', note: 'x' },
    } as unknown as ScenarioJson;
    expect(withExpectField(scenario, 'ticks', 3)).toEqual({
      result: 'success',
      note: 'x',
      ticks: 3,
    });
    expect(withExpectField(scenario, 'result', undefined)).toEqual({ note: 'x' });
    expect(withExpectField({ name: 'B', blackboard: {} }, 'result', undefined)).toBeUndefined();
    expect(
      withExpectField({ name: 'B', blackboard: {}, expect: { ticks: 1 } }, 'ticks', undefined),
    ).toBeUndefined();
  });

  it('formats and parses trees', () => {
    expect(formatTrees(undefined)).toBe('');
    expect(formatTrees('trees/*.json')).toBe('trees/*.json');
    expect(formatTrees(['a.json', 'b.json'])).toBe('a.json, b.json');
    expect(parseTrees(' a.json , ,b.json')).toEqual(['a.json', 'b.json']);
    expect(parseTrees(' ')).toBeUndefined();
  });
});
