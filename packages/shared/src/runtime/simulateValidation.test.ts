import { describe, expect, it } from 'vitest';
import {
  addScenario,
  removeScenario,
  uniqueScenarioName,
  updateScenario,
  validateProjectFile,
} from '../projectEdit';
import type { ProjectFile } from '../types';
import { checkAssignment, checkExpression, validateSimulate } from './simulateValidation';

describe('validateSimulate', () => {
  it('accepts valid settings and undefined', () => {
    expect(validateSimulate(undefined)).toEqual([]);
    expect(
      validateSimulate({
        mode: 'rule',
        duration: '{{Duration}} + 1',
        condition: 'Ammo > 0 && Enemy',
        effects: ['Ammo = Ammo - 1', 'Target = {{Key}}'],
        count: 2,
        ticks: '{{Seconds}}',
        composite: 'parallel',
        decorator: 'cooldown',
      }),
    ).toEqual([]);
  });

  it('reports bad enums, expressions and effects with their field', () => {
    const issues = validateSimulate({
      mode: 'nope' as never,
      composite: 'x' as never,
      decorator: 'y' as never,
      duration: '1 +',
      count: Number.NaN,
      condition: 'a b',
      effects: ['Ammo - 1', 'ok = 1'],
    });
    expect(issues.map((i) => i.field)).toEqual([
      'mode',
      'composite',
      'decorator',
      'duration',
      'count',
      'condition',
      'effects[0]',
    ]);
  });

  it('checks expressions and assignments', () => {
    expect(checkExpression('1 + 1')).toBeUndefined();
    expect(checkExpression('1 +')).toContain('Unexpected end');
    expect(checkAssignment('A = 1')).toBeUndefined();
    expect(checkAssignment('A + 1')).toContain("Expected '='");
  });
});

describe('validateProjectFile (run mode)', () => {
  it('reports invalid simulate expressions with the file path', () => {
    const file: ProjectFile = {
      nodes: [{ name: 'A', simulate: { condition: '((' } }],
      decorators: [{ name: 'D', simulate: { effects: ['x'] } }],
    };
    const issues = validateProjectFile(file);
    expect(issues.map((i) => i.path)).toEqual([
      'nodes[0].simulate.condition',
      'decorators[0].simulate.effects[0]',
    ]);
  });

  it('reports duplicate and empty scenario names and bad blackboards', () => {
    const file: ProjectFile = {
      scenarios: [
        { name: 'A', blackboard: {} },
        { name: 'A', blackboard: {} },
        { name: ' ', blackboard: {} },
        { name: 'B', blackboard: [] as never },
      ],
    };
    expect(validateProjectFile(file).map((i) => i.path)).toEqual([
      'scenarios[1].name',
      'scenarios[2].name',
      'scenarios[3].blackboard',
    ]);
  });
});

describe('scenario helpers', () => {
  it('adds, updates and removes scenarios', () => {
    const file: ProjectFile = {};
    addScenario(file, { name: ' One ', blackboard: { A: 1 } });
    expect(file.scenarios?.[0].name).toBe('One');
    expect(() => addScenario(file, { name: 'One', blackboard: {} })).toThrow('Duplicate');
    expect(() => addScenario(file, { name: ' ', blackboard: {} })).toThrow('empty');
    addScenario(file, { name: 'Two', blackboard: {} });
    expect(uniqueScenarioName(file, 'One')).toBe('One 2');
    updateScenario(file, 'One', { name: 'Uno', description: 'd' });
    expect(file.scenarios?.[0]).toMatchObject({ name: 'Uno', description: 'd' });
    updateScenario(file, 'Uno', { description: undefined });
    expect(file.scenarios?.[0].description).toBeUndefined();
    expect(() => updateScenario(file, 'Uno', { name: 'Two' })).toThrow('Duplicate');
    expect(() => updateScenario(file, 'missing', {})).toThrow('Unknown');
    expect(removeScenario(file, 'Uno')?.name).toBe('Uno');
    expect(removeScenario(file, 'nope')).toBeUndefined();
    removeScenario(file, 'Two');
    expect(file.scenarios).toBeUndefined();
  });
});
