import { describe, expect, it } from 'vitest';
import { compileProject, getItemType } from './compileProject';
import {
  addProperty,
  addType,
  canAddBase,
  checkTypeName,
  duplicateType,
  findType,
  findTypeReferences,
  listEffectiveProperties,
  moveProperty,
  moveType,
  removeCustomType,
  removeProperty,
  removeType,
  renameCustomType,
  renameType,
  setBases,
  setCustomType,
  updateProperty,
  updateType,
  uniqueTypeName,
  validateProjectFile,
  type ProjectIssue,
} from './projectEdit';
import type { ProjectFile } from './types';

/** Fresh project per test (helpers mutate their input). */
function sample(): ProjectFile {
  return {
    types: {
      blackboardKey: { type: 'string', pattern: '[A-Za-z_][A-Za-z0-9_]*' },
      probability: { type: 'number', pattern: '(0(\\.\\d+)?|1(\\.0+)?)' },
    },
    nodes: [
      { name: 'Selector', isComposite: true, icon: 'question' },
      { name: 'Sequence', isComposite: true, icon: 'arrow-right', color: '#111111' },
      { name: 'Base', isAbstract: true, properties: [{ name: 'Speed', type: 'number', min: 0 }] },
      {
        name: 'Wait',
        base: 'Base',
        description: 'Waits {{Speed}}',
        properties: [
          { name: 'Mode', type: 'enum', values: ['fast', 'slow'], default: 'fast' },
          { name: 'Key', type: 'blackboardKey' },
        ],
      },
      { name: 'Derived', base: ['Wait', 'Sequence'], isComposite: false },
    ],
    decorators: [{ name: 'Inverter', icon: 'rotate' }],
    services: [{ name: 'Logger', icon: 'file' }],
    export: { lua: { outDir: 'out/lua' } },
    futureField: { keep: true },
  } as ProjectFile;
}

function issuesOf(file: ProjectFile): ProjectIssue[] {
  return validateProjectFile(file);
}

describe('addType', () => {
  it('appends a type and inserts at an index', () => {
    const file = sample();
    addType(file, 'node', { name: 'NewNode' });
    expect(file.nodes?.at(-1)?.name).toBe('NewNode');

    addType(file, 'node', { name: 'AtStart' }, 0);
    expect(file.nodes?.[0].name).toBe('AtStart');
  });

  it('creates the list when the file has none', () => {
    const file: ProjectFile = {};
    addType(file, 'service', { name: 'Svc' });
    expect(file.services).toEqual([{ name: 'Svc' }]);
  });

  it('rejects empty and duplicate names', () => {
    const file = sample();
    expect(() => addType(file, 'node', { name: '  ' })).toThrow('must not be empty');
    expect(() => addType(file, 'node', { name: 'Selector' })).toThrow(
      "Duplicate type name 'Selector'",
    );
  });

  it('allows the same name in another kind', () => {
    const file = sample();
    addType(file, 'decorator', { name: 'Selector' });
    expect(findType(file, 'decorator', 'Selector')).toBeDefined();
  });
});

describe('uniqueTypeName', () => {
  it('numbers the name when taken', () => {
    const file = sample();
    expect(uniqueTypeName(file, 'node', 'NewNode')).toBe('NewNode');
    addType(file, 'node', { name: 'NewNode' });
    expect(uniqueTypeName(file, 'node', 'NewNode')).toBe('NewNode2');
    addType(file, 'node', { name: 'NewNode2' });
    expect(uniqueTypeName(file, 'node', 'NewNode')).toBe('NewNode3');
  });
});

describe('removeType', () => {
  it('removes the type and returns it', () => {
    const file = sample();
    const removed = removeType(file, 'node', 'Sequence');
    expect(removed?.name).toBe('Sequence');
    expect(findType(file, 'node', 'Sequence')).toBeUndefined();
  });

  it('returns undefined for unknown names and leaves references alone', () => {
    const file = sample();
    expect(removeType(file, 'node', 'Missing')).toBeUndefined();
    removeType(file, 'node', 'Base');
    expect(findType(file, 'node', 'Wait')?.base).toBe('Base');
  });
});

describe('renameType', () => {
  it('renames the type and updates string and array base references', () => {
    const file = sample();
    const updated = renameType(file, 'node', 'Base', 'Root');
    expect(updated).toBe(1);
    expect(findType(file, 'node', 'Root')?.isAbstract).toBe(true);
    expect(findType(file, 'node', 'Wait')?.base).toBe('Root');

    const count = renameType(file, 'node', 'Sequence', 'Seq');
    expect(count).toBe(1);
    expect(findType(file, 'node', 'Derived')?.base).toEqual(['Wait', 'Seq']);
  });

  it('only updates references within the same kind', () => {
    const file = sample();
    addType(file, 'decorator', { name: 'Base', base: 'Base' as never });
    renameType(file, 'node', 'Base', 'Root');
    expect(findType(file, 'decorator', 'Base')?.base).toBe('Base');
  });

  it('trims the new name and returns 0 for an unchanged name', () => {
    const file = sample();
    expect(renameType(file, 'node', 'Selector', 'Selector')).toBe(0);
    renameType(file, 'node', 'Selector', '  Choose  ');
    expect(findType(file, 'node', 'Choose')).toBeDefined();
  });

  it('rejects empty, duplicate and unknown names', () => {
    const file = sample();
    expect(() => renameType(file, 'node', 'Selector', ' ')).toThrow('must not be empty');
    expect(() => renameType(file, 'node', 'Selector', 'Sequence')).toThrow('Duplicate');
    expect(() => renameType(file, 'node', 'Nope', 'X')).toThrow("Unknown node type 'Nope'");
  });
});

describe('duplicateType', () => {
  it('copies the type after the original with a unique " copy" name', () => {
    const file = sample();
    expect(duplicateType(file, 'node', 'Wait')).toBe('Wait copy');
    expect(duplicateType(file, 'node', 'Wait')).toBe('Wait copy2');
    const names = file.nodes?.map((n) => n.name);
    expect(names?.slice(3, 6)).toEqual(['Wait', 'Wait copy2', 'Wait copy']);
  });

  it('deep-copies properties so the copy can be edited independently', () => {
    const file = sample();
    duplicateType(file, 'node', 'Wait');
    const copy = findType(file, 'node', 'Wait copy');
    addProperty(file, 'node', 'Wait copy', { name: 'Extra', type: 'bool' });
    expect(copy?.properties?.map((p) => p.name)).toEqual(['Mode', 'Key', 'Extra']);
    expect(findType(file, 'node', 'Wait')?.properties?.map((p) => p.name)).toEqual(['Mode', 'Key']);
  });

  it('throws for unknown types', () => {
    expect(() => duplicateType(sample(), 'node', 'Nope')).toThrow();
  });
});

describe('moveType', () => {
  it('moves a type within its kind', () => {
    const file = sample();
    moveType(file, 'node', 0, 2);
    expect(file.nodes?.map((n) => n.name).slice(0, 3)).toEqual(['Sequence', 'Base', 'Selector']);
  });

  it('rejects out of range indices', () => {
    expect(() => moveType(sample(), 'node', 0, 99)).toThrow('out of range');
    expect(() => moveType(sample(), 'node', -1, 0)).toThrow('out of range');
  });
});

describe('findTypeReferences', () => {
  it('lists derived types of the same kind', () => {
    const file = sample();
    expect(findTypeReferences(file, 'node', 'Base')).toEqual(['Wait']);
    expect(findTypeReferences(file, 'node', 'Wait')).toEqual(['Derived']);
    expect(findTypeReferences(file, 'node', 'Sequence')).toEqual(['Derived']);
    expect(findTypeReferences(file, 'node', 'Selector')).toEqual([]);
  });
});

describe('updateType', () => {
  it('sets, replaces and removes fields', () => {
    const file = sample();
    updateType(file, 'node', 'Selector', { icon: 'bars', color: '#222222', description: 'x' });
    expect(findType(file, 'node', 'Selector')).toMatchObject({
      icon: 'bars',
      color: '#222222',
      description: 'x',
    });
    updateType(file, 'node', 'Selector', { icon: undefined, base: undefined });
    expect(findType(file, 'node', 'Selector')).not.toHaveProperty('icon');
  });

  it('ignores name changes (use renameType)', () => {
    const file = sample();
    updateType(file, 'node', 'Selector', { name: 'Other' });
    expect(findType(file, 'node', 'Selector')).toBeDefined();
  });
});

describe('properties', () => {
  it('adds, inserts, removes and moves properties', () => {
    const file = sample();
    addProperty(file, 'node', 'Sequence', { name: 'A', type: 'string' });
    addProperty(file, 'node', 'Sequence', { name: 'B', type: 'string' }, 0);
    expect(findType(file, 'node', 'Sequence')?.properties?.map((p) => p.name)).toEqual(['B', 'A']);

    moveProperty(file, 'node', 'Sequence', 0, 1);
    expect(findType(file, 'node', 'Sequence')?.properties?.map((p) => p.name)).toEqual(['A', 'B']);

    expect(removeProperty(file, 'node', 'Sequence', 'A')?.name).toBe('A');
    expect(removeProperty(file, 'node', 'Sequence', 'A')).toBeUndefined();
  });

  it('creates the properties list on demand', () => {
    const file = sample();
    addProperty(file, 'node', 'Selector', { name: 'X', type: 'bool' });
    expect(findType(file, 'node', 'Selector')?.properties).toEqual([{ name: 'X', type: 'bool' }]);
  });

  it('rejects duplicate and empty property names', () => {
    const file = sample();
    expect(() => addProperty(file, 'node', 'Wait', { name: 'Mode', type: 'string' })).toThrow(
      "Duplicate property 'Mode'",
    );
    expect(() => addProperty(file, 'node', 'Wait', { name: '', type: 'string' })).toThrow(
      'must not be empty',
    );
  });

  it('updates fields and removes undefined ones, renames with a duplicate check', () => {
    const file = sample();
    updateProperty(file, 'node', 'Wait', 'Mode', { default: 'slow', description: 'd' });
    updateProperty(file, 'node', 'Wait', 'Mode', { description: undefined });
    const mode = findType(file, 'node', 'Wait')?.properties?.[0];
    expect(mode?.default).toBe('slow');
    expect(mode).not.toHaveProperty('description');

    updateProperty(file, 'node', 'Wait', 'Mode', { name: 'Speed2' });
    expect(findType(file, 'node', 'Wait')?.properties?.[0].name).toBe('Speed2');
    expect(() => updateProperty(file, 'node', 'Wait', 'Speed2', { name: 'Key' })).toThrow(
      "Duplicate property 'Key'",
    );
    expect(() => updateProperty(file, 'node', 'Wait', 'Nope', { name: 'X' })).toThrow(
      "Unknown property 'Nope'",
    );
  });
});

describe('custom types', () => {
  it('sets and removes custom types', () => {
    const file = sample();
    setCustomType(file, 'tag', { type: 'string', pattern: '[a-z]+' });
    expect(file.types?.tag).toEqual({ type: 'string', pattern: '[a-z]+' });
    expect(removeCustomType(file, 'tag')).toEqual({ type: 'string', pattern: '[a-z]+' });
    expect(removeCustomType(file, 'tag')).toBeUndefined();
  });

  it('creates the types map when absent', () => {
    const file: ProjectFile = {};
    setCustomType(file, 'n', { type: 'number' });
    expect(file.types).toEqual({ n: { type: 'number' } });
  });

  it('renames a custom type in place and updates property types', () => {
    const file = sample();
    const updated = renameCustomType(file, 'blackboardKey', 'bbKey');
    expect(updated).toBe(1);
    expect(Object.keys(file.types ?? {})).toEqual(['bbKey', 'probability']);
    expect(findType(file, 'node', 'Wait')?.properties?.[1].type).toBe('bbKey');
  });

  it('rejects renames to existing or unknown custom types', () => {
    const file = sample();
    expect(() => renameCustomType(file, 'blackboardKey', 'probability')).toThrow('Duplicate');
    expect(() => renameCustomType(file, 'missing', 'x')).toThrow('Unknown custom type');
    expect(() => renameCustomType(file, 'blackboardKey', ' ')).toThrow('must not be empty');
    expect(renameCustomType(file, 'probability', 'probability')).toBe(0);
  });
});

describe('listEffectiveProperties', () => {
  it('lists inherited properties first with their owner', () => {
    const file = sample();
    const props = listEffectiveProperties(file, 'node', 'Wait');
    expect(props.map((e) => [e.prop.name, e.from])).toEqual([
      ['Speed', 'Base'],
      ['Mode', undefined],
      ['Key', undefined],
    ]);
  });

  it('lets a derived type redeclare a base property in place', () => {
    const file = sample();
    addProperty(file, 'node', 'Wait', { name: 'Speed', type: 'string' });
    const props = listEffectiveProperties(file, 'node', 'Wait');
    expect(props[0]).toEqual({ prop: { name: 'Speed', type: 'string' }, from: undefined });
  });

  it('merges multiple bases', () => {
    const file = sample();
    const names = listEffectiveProperties(file, 'node', 'Derived').map((e) => e.prop.name);
    expect(names).toEqual(['Speed', 'Mode', 'Key']);
  });

  it('terminates on cyclic inheritance and returns no inherited entries from missing bases', () => {
    const file: ProjectFile = {
      nodes: [
        { name: 'A', base: 'B', properties: [{ name: 'a', type: 'bool' }] },
        { name: 'B', base: 'A', properties: [{ name: 'b', type: 'bool' }] },
        { name: 'C', base: 'Missing' },
      ],
    };
    expect(listEffectiveProperties(file, 'node', 'A').map((e) => e.prop.name)).toEqual(['b', 'a']);
    expect(listEffectiveProperties(file, 'node', 'C')).toEqual([]);
  });
});

describe('validateProjectFile', () => {
  it('reports nothing for a valid project', () => {
    expect(issuesOf(sample())).toEqual([]);
  });

  it('reports empty and duplicate type names with their paths', () => {
    const file: ProjectFile = {
      nodes: [{ name: '' }, { name: 'A' }, { name: 'A' }],
    };
    const issues = issuesOf(file);
    expect(issues).toContainEqual({
      path: 'nodes[0].name',
      message: 'Name is required',
      severity: 'error',
    });
    expect(issues).toContainEqual({
      path: 'nodes[2].name',
      message: "Duplicate type name 'A'",
      severity: 'error',
    });
  });

  it('reports missing bases', () => {
    const issues = issuesOf({ decorators: [{ name: 'D', base: ['Gone'] }] });
    expect(issues).toEqual([
      { path: 'decorators[0].base', message: "Missing base 'Gone'", severity: 'error' },
    ]);
  });

  it('reports inheritance cycles on each member once', () => {
    const file: ProjectFile = {
      services: [
        { name: 'A', base: 'B' },
        { name: 'B', base: 'C' },
        { name: 'C', base: 'A' },
        { name: 'Ok' },
      ],
    };
    const issues = issuesOf(file).filter((i) => i.message.startsWith('Inheritance cycle'));
    expect(issues.map((i) => i.path)).toEqual([
      'services[0].base',
      'services[1].base',
      'services[2].base',
    ]);
    expect(issues[0].message).toBe('Inheritance cycle: A -> B -> C -> A');
  });

  it('reports a self base as a cycle', () => {
    const issues = issuesOf({ nodes: [{ name: 'S', base: 'S' }] });
    expect(issues[0]).toMatchObject({ path: 'nodes[0].base', severity: 'error' });
  });

  it('reports enum without values and defaults outside the enum', () => {
    const issues = issuesOf({
      nodes: [
        {
          name: 'N',
          properties: [
            { name: 'E', type: 'enum' },
            { name: 'F', type: 'enum', values: ['a'], default: 'b' },
          ],
        },
      ],
    });
    expect(issues).toContainEqual({
      path: 'nodes[0].properties[0].values',
      message: 'Enum needs at least one value',
      severity: 'error',
    });
    expect(issues).toContainEqual({
      path: 'nodes[0].properties[1].default',
      message: "Default 'b' is not one of the enum values",
      severity: 'error',
    });
  });

  it('reports defaults outside min/max and min greater than max', () => {
    const issues = issuesOf({
      nodes: [
        {
          name: 'N',
          properties: [
            { name: 'A', type: 'number', min: 1, max: 5, default: 9 },
            { name: 'B', type: 'number', min: 10, max: 2 },
          ],
        },
      ],
    });
    expect(issues).toContainEqual({
      path: 'nodes[0].properties[0].default',
      message: 'Default 9 is outside min/max',
      severity: 'error',
    });
    expect(issues).toContainEqual({
      path: 'nodes[0].properties[1].min',
      message: 'min is greater than max',
      severity: 'error',
    });
  });

  it('checks defaults of custom types against their pattern', () => {
    const file = sample();
    addProperty(file, 'node', 'Sequence', { name: 'P', type: 'probability', default: 2 });
    addProperty(file, 'node', 'Sequence', { name: 'K', type: 'blackboardKey', default: '9bad' });
    addProperty(file, 'node', 'Sequence', { name: 'Good', type: 'blackboardKey', default: 'ok_1' });
    const paths = issuesOf(file).map((i) => i.path);
    expect(paths).toContain('nodes[1].properties[0].default');
    expect(paths).toContain('nodes[1].properties[1].default');
    expect(paths).not.toContain('nodes[1].properties[2].default');
  });

  it('reports wrong default types for bool and number', () => {
    const issues = issuesOf({
      nodes: [
        {
          name: 'N',
          properties: [
            { name: 'B', type: 'bool', default: 'yes' },
            { name: 'C', type: 'number', default: '3' },
          ],
        },
      ],
    });
    expect(issues.map((i) => i.message)).toEqual([
      'Default must be true or false',
      'Default must be a number',
    ]);
  });

  it('reports duplicate property names within one type only', () => {
    const issues = issuesOf({
      nodes: [
        {
          name: 'N',
          properties: [
            { name: 'X', type: 'bool' },
            { name: 'X', type: 'bool' },
          ],
        },
        { name: 'M', properties: [{ name: 'X', type: 'bool' }] },
      ],
    });
    expect(issues).toEqual([
      {
        path: 'nodes[0].properties[1].name',
        message: "Duplicate property 'X'",
        severity: 'error',
      },
    ]);
  });

  it('warns about unknown property types but errors on missing types', () => {
    const issues = issuesOf({
      nodes: [
        {
          name: 'N',
          properties: [
            { name: 'U', type: 'mystery' },
            { name: 'V', type: '' },
          ],
        },
      ],
    });
    expect(issues).toContainEqual({
      path: 'nodes[0].properties[0].type',
      message: "Unknown property type 'mystery'",
      severity: 'warning',
    });
    expect(issues).toContainEqual({
      path: 'nodes[0].properties[1].type',
      message: 'Property type is required',
      severity: 'error',
    });
  });

  it('reports invalid custom type definitions', () => {
    const issues = issuesOf({
      types: {
        bad: { type: 'bool' as 'string', pattern: '(' },
      },
    });
    expect(issues.map((i) => i.path)).toEqual(['types.bad.type', 'types.bad.pattern']);
    expect(issues[1].message).toMatch(/^Invalid pattern: /);
  });

  it('does not report missing icons or colors', () => {
    expect(issuesOf({ nodes: [{ name: 'N', icon: '', color: '' }] })).toEqual([]);
  });

  it('reports only errors that make compileProject throw when bases are broken', () => {
    const file: ProjectFile = {
      nodes: [
        { name: 'A', base: 'B' },
        { name: 'B', base: 'A' },
      ],
    };
    expect(() => compileProject(file)).toThrow('Cyclic inheritance');
    expect(issuesOf(file).some((i) => i.severity === 'error')).toBe(true);
  });
});

describe('canAddBase and setBases', () => {
  it('rejects self, unknown and cyclic bases', () => {
    const file = sample();
    expect(canAddBase(file, 'node', 'Selector', 'Selector')).toBe(false);
    expect(canAddBase(file, 'node', 'Selector', 'Nope')).toBe(false);
    // Wait derives from Base, so Base cannot derive from Wait.
    expect(canAddBase(file, 'node', 'Base', 'Wait')).toBe(false);
    expect(canAddBase(file, 'node', 'Selector', 'Wait')).toBe(true);
    // Derived -> Wait -> Base; Base -> Derived would close the loop through Wait.
    expect(canAddBase(file, 'node', 'Base', 'Derived')).toBe(false);
  });

  it('stores one base as a string, several as an array and none as no field', () => {
    const file = sample();
    setBases(file, 'node', 'Selector', ['Sequence', 'Sequence']);
    expect(findType(file, 'node', 'Selector')?.base).toBe('Sequence');
    setBases(file, 'node', 'Selector', ['Sequence', 'Base']);
    expect(findType(file, 'node', 'Selector')?.base).toEqual(['Sequence', 'Base']);
    setBases(file, 'node', 'Selector', []);
    expect(findType(file, 'node', 'Selector')).not.toHaveProperty('base');
  });
});

describe('stored names are trimmed', () => {
  it('addType stores the trimmed name without changing the caller descriptor', () => {
    const file: ProjectFile = {};
    const desc = { name: '  Padded  ', icon: 'star' };
    addType(file, 'node', desc);
    expect(file.nodes).toEqual([{ name: 'Padded', icon: 'star' }]);
    expect(desc.name).toBe('  Padded  ');
  });

  it('addProperty stores the trimmed property name and keeps the caller object intact', () => {
    const file = sample();
    const prop = { name: '  Extra ', type: 'number' };
    addProperty(file, 'node', 'Selector', prop);
    expect(findType(file, 'node', 'Selector')?.properties?.[0].name).toBe('Extra');
    expect(prop.name).toBe('  Extra ');
  });

  it('updateProperty stores the trimmed new name and rejects blank ones', () => {
    const file = sample();
    updateProperty(file, 'node', 'Wait', 'Mode', { name: '  Gear ' });
    expect(findType(file, 'node', 'Wait')?.properties?.[0].name).toBe('Gear');
    expect(() => updateProperty(file, 'node', 'Wait', 'Gear', { name: ' ' })).toThrow(
      'must not be empty',
    );
  });

  it('setCustomType stores the trimmed name', () => {
    const file = sample();
    setCustomType(file, '  tag ', { type: 'string' });
    expect(Object.keys(file.types ?? {})).toContain('tag');
    expect(Object.keys(file.types ?? {})).not.toContain('  tag ');
  });

  it('renameType and renameCustomType store the trimmed target', () => {
    const file = sample();
    renameType(file, 'node', 'Selector', '  Chooser ');
    expect(findType(file, 'node', 'Chooser')).toBeDefined();
    renameCustomType(file, 'probability', '  odds ');
    expect(Object.keys(file.types ?? {})).toEqual(['blackboardKey', 'odds']);
  });
});

describe('reserved type names', () => {
  it('checkTypeName trims and rejects empty, blank and reserved names', () => {
    expect(checkTypeName(' Ok ')).toBe('Ok');
    expect(() => checkTypeName('   ')).toThrow('must not be empty');
    for (const name of ['__proto__', 'constructor', 'prototype', ' __proto__ ']) {
      expect(() => checkTypeName(name)).toThrow('is reserved');
    }
  });

  it('addType, renameType, setCustomType and renameCustomType reject reserved names', () => {
    const file = sample();
    for (const name of ['__proto__', 'constructor', 'prototype']) {
      expect(() => addType(file, 'node', { name })).toThrow('is reserved');
      expect(() => renameType(file, 'node', 'Selector', name)).toThrow('is reserved');
      expect(() => setCustomType(file, name, { type: 'string' })).toThrow('is reserved');
      expect(() => renameCustomType(file, 'probability', name)).toThrow('is reserved');
    }
    expect(() => setCustomType(file, '  ', { type: 'string' })).toThrow('must not be empty');
    expect(file.types).not.toHaveProperty('constructor');
    expect(Object.getPrototypeOf(file.types)).toBe(Object.prototype);
  });

  it('validateProjectFile reports reserved type names as errors', () => {
    const file: ProjectFile = {
      nodes: [{ name: '__proto__' }],
      decorators: [{ name: 'prototype' }],
      types: { constructor: { type: 'string' as const } },
    };
    const errors = issuesOf(file).filter((issue) => issue.severity === 'error');
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'nodes[0].name',
          message: "Type name '__proto__' is reserved",
        }),
        expect.objectContaining({
          path: 'decorators[0].name',
          message: "Type name 'prototype' is reserved",
        }),
        expect.objectContaining({
          path: 'types.constructor',
          message: "Type name 'constructor' is reserved",
        }),
      ]),
    );
  });

  it('compiles and looks up a type named like an Object.prototype member without touching the prototype', () => {
    const compiled = compileProject({ nodes: [{ name: '__proto__', isComposite: true }] });
    expect(Object.hasOwn(compiled.nodes, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(compiled.nodes)).toBeNull();
    expect(getItemType(compiled, 'node', 'constructor').isInvalid).toBe(true);
    expect(getItemType(compiled, 'node', 'toString').isInvalid).toBe(true);
    expect(({} as Record<string, unknown>).isComposite).toBeUndefined();
  });
});
