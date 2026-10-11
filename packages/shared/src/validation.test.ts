import { describe, expect, it } from 'vitest';
import { compileProject, getItemType } from './compileProject';
import {
  collectMissingTypes,
  formatMissingTypes,
  getEffectiveValue,
  isTreeValid,
  validateItem,
  validatePropertyValue,
} from './validation';
import type { CompiledProperty, SubItem, TreeNode } from './types';

const prop = (
  overrides: Partial<CompiledProperty> & Pick<CompiledProperty, 'type'>,
): CompiledProperty => ({
  name: 'p',
  ...overrides,
});

describe('validatePropertyValue', () => {
  it('treats null, undefined and empty string as valid for every type', () => {
    for (const p of [
      prop({ type: 'number', min: 1 }),
      prop({ type: 'bool' }),
      prop({ type: 'enum', values: ['a'] }),
    ]) {
      expect(validatePropertyValue(p, null)).toBe(true);
      expect(validatePropertyValue(p, undefined)).toBe(true);
      expect(validatePropertyValue(p, '')).toBe(true);
    }
  });

  it('accepts any value for string properties', () => {
    expect(validatePropertyValue(prop({ type: 'string' }), 'anything')).toBe(true);
    expect(validatePropertyValue(prop({ type: 'string' }), 42)).toBe(true);
  });

  it('validates numbers: finite and within min/max (inclusive)', () => {
    const p = prop({ type: 'number', min: 0, max: 10 });
    expect(validatePropertyValue(p, 0)).toBe(true);
    expect(validatePropertyValue(p, 10)).toBe(true);
    expect(validatePropertyValue(p, 5.5)).toBe(true);
    expect(validatePropertyValue(p, -0.1)).toBe(false);
    expect(validatePropertyValue(p, 10.1)).toBe(false);
  });

  it('rejects non-finite and non-number values for numbers', () => {
    const p = prop({ type: 'number' });
    expect(validatePropertyValue(p, Number.NaN)).toBe(false);
    expect(validatePropertyValue(p, Number.POSITIVE_INFINITY)).toBe(false);
    expect(validatePropertyValue(p, '5')).toBe(false);
    expect(validatePropertyValue(p, true)).toBe(false);
  });

  it('accepts unbounded numbers', () => {
    expect(validatePropertyValue(prop({ type: 'number' }), -1e12)).toBe(true);
  });

  it('validates enum values', () => {
    const p = prop({ type: 'enum', values: ['red', 'green'] });
    expect(validatePropertyValue(p, 'red')).toBe(true);
    expect(validatePropertyValue(p, 'blue')).toBe(false);
    expect(validatePropertyValue(p, 1)).toBe(false);
    expect(validatePropertyValue(prop({ type: 'enum' }), 'x')).toBe(false);
  });

  it('validates booleans', () => {
    expect(validatePropertyValue(prop({ type: 'bool' }), true)).toBe(true);
    expect(validatePropertyValue(prop({ type: 'bool' }), false)).toBe(true);
    expect(validatePropertyValue(prop({ type: 'bool' }), 'true')).toBe(false);
  });

  it('matches a custom pattern anchored to the whole value', () => {
    const p = prop({ type: 'string', customType: 'hex', pattern: '[0-9a-f]+' });
    expect(validatePropertyValue(p, 'ff0')).toBe(true);
    expect(validatePropertyValue(p, 'xff')).toBe(false);
    expect(validatePropertyValue(p, 'ff0x')).toBe(false);
  });

  it('applies the pattern to the string form of non-string values', () => {
    const p = prop({ type: 'number', customType: 'digits', pattern: '\\d+' });
    expect(validatePropertyValue(p, 12)).toBe(true);
    expect(validatePropertyValue(p, 'abc')).toBe(false);
  });

  it('gives the pattern precedence over min/max (min/max ignored for custom types)', () => {
    const p = prop({ type: 'number', pattern: '.*', min: 100 });
    expect(validatePropertyValue(p, 1)).toBe(true);
  });

  it('treats an invalid pattern as invalid', () => {
    expect(validatePropertyValue(prop({ type: 'string', pattern: '(' }), 'x')).toBe(false);
  });

  it('gives the same answers when a pattern is reused or changed', () => {
    for (let i = 0; i < 3; i++) {
      expect(validatePropertyValue(prop({ type: 'string', pattern: '[a-z]+' }), 'abc')).toBe(true);
      expect(validatePropertyValue(prop({ type: 'string', pattern: '[a-z]+' }), 'ABC')).toBe(false);
      expect(validatePropertyValue(prop({ type: 'string', pattern: '[A-Z]+' }), 'ABC')).toBe(true);
      expect(validatePropertyValue(prop({ type: 'string', pattern: '(' }), 'x')).toBe(false);
    }
  });

  it('keeps working after many distinct patterns', () => {
    for (let i = 0; i < 1500; i++) {
      expect(
        validatePropertyValue(prop({ type: 'string', pattern: `x{${i}}` }), 'x'.repeat(i)),
      ).toBe(true);
    }
  });

  it('ignores an empty pattern and falls back to the type checks', () => {
    expect(validatePropertyValue(prop({ type: 'bool', pattern: '' }), 'x')).toBe(false);
  });
});

describe('getEffectiveValue', () => {
  const p = prop({ type: 'number', default: 7 });

  it('returns the explicit value when set', () => {
    expect(getEffectiveValue(p, { p: 3 })).toBe(3);
  });

  it('returns the default when not set', () => {
    expect(getEffectiveValue(p, {})).toBe(7);
  });

  it('returns an explicit null as set (not the default)', () => {
    expect(getEffectiveValue(p, { p: null })).toBeNull();
  });

  it('returns undefined when there is neither a value nor a default', () => {
    expect(getEffectiveValue(prop({ type: 'string' }), {})).toBeUndefined();
  });
});

describe('validateItem', () => {
  const project = compileProject({
    types: { digits: { type: 'string', pattern: '\\d+' } },
    nodes: [
      {
        name: 'Wait',
        properties: [
          { name: 'Time', type: 'number', min: 0, default: 1 },
          { name: 'Mode', type: 'enum', values: ['a', 'b'] },
          { name: 'Code', type: 'digits' },
        ],
      },
    ],
  });
  const waitType = getItemType(project, 'node', 'Wait');

  it('is valid for a valid item (defaults count as values)', () => {
    expect(validateItem(waitType, {})).toEqual({
      missingType: false,
      invalidProperties: [],
      isValid: true,
    });
  });

  it('lists invalid properties by name', () => {
    const res = validateItem(waitType, { Time: -5, Mode: 'c', Code: 'abc' });
    expect(res).toEqual({
      missingType: false,
      invalidProperties: ['Time', 'Mode', 'Code'],
      isValid: false,
    });
  });

  it('reports a missing type as invalid', () => {
    const missing = getItemType(project, 'node', 'Nope');
    expect(validateItem(missing, {})).toEqual({
      missingType: true,
      invalidProperties: [],
      isValid: false,
    });
  });

  it('validates the default value when the property is not set', () => {
    const bad = compileProject({
      nodes: [{ name: 'X', properties: [{ name: 'n', type: 'number', min: 10, default: 1 }] }],
    });
    expect(validateItem(getItemType(bad, 'node', 'X'), {}).invalidProperties).toEqual(['n']);
  });
});

describe('collectMissingTypes / formatMissingTypes', () => {
  const project = compileProject({
    nodes: [{ name: 'Seq', isComposite: true }],
    decorators: [{ name: 'Inv' }],
    services: [{ name: 'Log' }],
  });

  function tree(): TreeNode {
    const sub = (id: string, type: string): SubItem => ({ id, type, properties: {}, extra: {} });
    const mk = (
      id: string,
      type: string,
      childNodes: TreeNode[] = [],
      decorators: SubItem[] = [],
      services: SubItem[] = [],
    ): TreeNode => ({
      id,
      type,
      properties: {},
      decorators,
      services,
      childNodes,
      extra: {},
    });
    return mk('root', 'Seq', [
      mk('a', 'Zed', [], [sub('d1', 'Missing2')], [sub('s1', 'Missing1')]),
      mk('b', 'Alpha', [mk('c', 'Zed', [], [sub('d2', 'Missing2')])], [], [sub('s2', 'Log')]),
      mk('d', 'Seq', [], [sub('d3', 'Inv')], [sub('s3', 'Missing1')]),
    ]);
  }

  it('collects unique, sorted missing names per kind', () => {
    expect(collectMissingTypes(tree(), project)).toEqual({
      nodes: ['Alpha', 'Zed'],
      decorators: ['Missing2'],
      services: ['Missing1'],
    });
  });

  it('returns empty lists when everything is known', () => {
    const root: TreeNode = {
      id: 'r',
      type: 'Seq',
      properties: {},
      decorators: [],
      services: [],
      childNodes: [],
      extra: {},
    };
    expect(collectMissingTypes(root, project)).toEqual({ nodes: [], decorators: [], services: [] });
  });

  it('formats missing types as lines using the original messages', () => {
    expect(formatMissingTypes({ nodes: ['A', 'B'], decorators: ['D'], services: [] })).toEqual([
      'Missing node descriptors: A, B',
      'Missing decorator descriptors: D',
    ]);
  });

  it('formats a single service line', () => {
    expect(formatMissingTypes({ nodes: [], decorators: [], services: ['S'] })).toEqual([
      'Missing service descriptors: S',
    ]);
  });

  it('returns null when nothing is missing', () => {
    expect(formatMissingTypes({ nodes: [], decorators: [], services: [] })).toBeNull();
  });
});

describe('isTreeValid', () => {
  const project = compileProject({
    nodes: [{ name: 'Wait', properties: [{ name: 'Time', type: 'number', min: 0 }] }],
    decorators: [{ name: 'Inv' }],
  });

  function root(time: unknown, nodeType = 'Wait', decType = 'Inv'): TreeNode {
    return {
      id: 'r',
      type: nodeType,
      properties: { Time: time },
      decorators: [{ id: 'd', type: decType, properties: {}, extra: {} }],
      services: [],
      childNodes: [],
      extra: {},
    };
  }

  it('is true for a tree of known types with valid values', () => {
    expect(isTreeValid(root(3), project)).toBe(true);
  });

  it('is false when a property value is invalid', () => {
    expect(isTreeValid(root(-1), project)).toBe(false);
  });

  it('is false when a node or sub item type is missing', () => {
    expect(isTreeValid(root(3, 'Nope'), project)).toBe(false);
    expect(isTreeValid(root(3, 'Wait', 'Nope'), project)).toBe(false);
  });

  it('checks nested children', () => {
    const tree = root(3);
    tree.childNodes.push({
      id: 'k',
      type: 'Wait',
      properties: { Time: -9 },
      decorators: [],
      services: [],
      childNodes: [],
      extra: {},
    });
    expect(isTreeValid(tree, project)).toBe(false);
  });
});
