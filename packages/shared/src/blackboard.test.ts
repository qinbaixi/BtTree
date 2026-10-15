import { describe, expect, it } from 'vitest';
import {
  addBlackboardKey,
  blackboardKeyStartValue,
  findBlackboardKey,
  isUndeclaredBlackboardKey,
  isValidBlackboardKeyName,
  removeBlackboardKey,
  renameBlackboardKey,
  uniqueBlackboardKeyName,
  updateBlackboardKey,
  validateBlackboardDeclarations,
} from './blackboard';
import { compileProject } from './compileProject';
import { validateProjectFile } from './projectEdit';
import type { ProjectFile } from './types';

function sample(): ProjectFile {
  return {
    types: { blackboardKey: { type: 'string' } },
    nodes: [
      {
        name: 'MoveTo',
        properties: [
          { name: 'Target', type: 'blackboardKey', default: 'Enemy' },
          { name: 'Note', type: 'string', default: 'Enemy' },
        ],
      },
    ],
    scenarios: [{ name: 'S', blackboard: { Enemy: true, Ammo: 1 } }],
    blackboard: [
      { name: 'Enemy', type: 'bool', default: false, custom: 1 },
      { name: 'Ammo', type: 'number' },
    ],
  };
}

describe('blackboard declarations', () => {
  it('validates names', () => {
    expect(isValidBlackboardKeyName('Ammo_2')).toBe(true);
    expect(isValidBlackboardKeyName('2ammo')).toBe(false);
    expect(isValidBlackboardKeyName('has space')).toBe(false);
  });

  it('adds, updates and removes keys keeping unknown fields', () => {
    const file = sample();
    addBlackboardKey(file, { name: ' Position ', type: 'string' });
    expect(findBlackboardKey(file, 'Position')).toEqual({ name: 'Position', type: 'string' });
    expect(() => addBlackboardKey(file, { name: 'Ammo', type: 'number' })).toThrow('Duplicate');
    expect(() => addBlackboardKey(file, { name: '1x', type: 'number' })).toThrow('Invalid');
    updateBlackboardKey(file, 'Enemy', { default: undefined, description: 'seen' });
    expect(findBlackboardKey(file, 'Enemy')).toEqual({
      name: 'Enemy',
      type: 'bool',
      custom: 1,
      description: 'seen',
    });
    removeBlackboardKey(file, 'Enemy');
    removeBlackboardKey(file, 'Ammo');
    removeBlackboardKey(file, 'Position');
    expect(file.blackboard).toBeUndefined();
  });

  it('suggests unique names', () => {
    const file = sample();
    expect(uniqueBlackboardKeyName(file, 'Enemy')).toBe('Enemy2');
    expect(uniqueBlackboardKeyName({}, 'Key')).toBe('Key');
  });

  it('renames keys with their defaults and scenario entries', () => {
    const file = sample();
    const result = renameBlackboardKey(file, 'Enemy', 'Foe');
    expect(result).toEqual({ defaults: 1, scenarios: 1 });
    expect(file.blackboard?.[0]).toMatchObject({ name: 'Foe', custom: 1 });
    expect(file.nodes?.[0].properties?.[0].default).toBe('Foe');
    // Not a blackboardKey property: unchanged.
    expect(file.nodes?.[0].properties?.[1].default).toBe('Enemy');
    expect(Object.keys(file.scenarios?.[0].blackboard ?? {})).toEqual(['Foe', 'Ammo']);
    expect(() => renameBlackboardKey(file, 'Foe', 'Ammo')).toThrow('Duplicate');
    expect(() => renameBlackboardKey(file, 'Nope', 'X')).toThrow('Unknown');
  });

  it('reports invalid declarations', () => {
    const file: ProjectFile = {
      blackboard: [
        { name: 'A', type: 'number', default: 'x' },
        { name: 'A', type: 'string' },
        { name: '9', type: 'string' },
        { name: '', type: 'string' },
        { name: 'B', type: 'vector' },
      ],
    };
    expect(validateBlackboardDeclarations(file)).toEqual([
      {
        path: 'blackboard[0].default',
        message: "Default of 'A' is not a number",
        severity: 'error',
      },
      { path: 'blackboard[1].name', message: "Duplicate blackboard key 'A'", severity: 'error' },
      expect.objectContaining({ path: 'blackboard[2].name', severity: 'error' }),
      { path: 'blackboard[3].name', message: 'Key name is required', severity: 'error' },
      expect.objectContaining({ path: 'blackboard[4].type', severity: 'warning' }),
    ]);
    expect(validateProjectFile(file).map((issue) => issue.path)).toContain('blackboard[1].name');
    expect(
      validateBlackboardDeclarations({ blackboard: {} as unknown as ProjectFile['blackboard'] }),
    ).toHaveLength(1);
    expect(validateBlackboardDeclarations({})).toEqual([]);
  });

  it('gives start values from defaults or the type', () => {
    expect(blackboardKeyStartValue({ name: 'A', type: 'number' })).toBe(0);
    expect(blackboardKeyStartValue({ name: 'A', type: 'bool' })).toBe(false);
    expect(blackboardKeyStartValue({ name: 'A', type: 'string' })).toBe('');
    expect(blackboardKeyStartValue({ name: 'A', type: 'any' })).toBeNull();
    expect(blackboardKeyStartValue({ name: 'A', type: 'number', default: 3 })).toBe(3);
  });

  it('compiles declarations and warns about undeclared keys', () => {
    const compiled = compileProject(sample());
    expect(compiled.blackboard?.map((key) => key.name)).toEqual(['Enemy', 'Ammo']);
    const prop = compiled.nodes.MoveTo.properties[0];
    expect(isUndeclaredBlackboardKey(compiled, prop, 'Enemy')).toBe(false);
    expect(isUndeclaredBlackboardKey(compiled, prop, 'Other')).toBe(true);
    expect(isUndeclaredBlackboardKey(compiled, prop, '')).toBe(false);
    expect(isUndeclaredBlackboardKey(compiled, compiled.nodes.MoveTo.properties[1], 'Other')).toBe(
      false,
    );
    // Without declarations nothing is reported.
    const plain = compileProject({ ...sample(), blackboard: undefined });
    expect(plain.blackboard).toBeUndefined();
    expect(isUndeclaredBlackboardKey(plain, prop, 'Other')).toBe(false);
  });
});
