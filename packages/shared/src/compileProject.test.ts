import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COLORS,
  compileProject,
  getItemType,
  parseAndCompileProject,
} from './compileProject';
import type { ProjectFile, PropertyDescJson } from './types';

/** Port of projectStore.service.spec.js `_compileProject` inheritance case. */
const inheritanceProject: ProjectFile = {
  nodes: [
    {
      name: 'node1',
      icon: 'icon1',
      base: 'base-node1',
      isComposite: true,
      properties: [
        { name: 'TargetBlackboardKey', default: 'yy', type: 'string' },
        { name: 'Speed', default: -1.0, type: 'number' },
      ],
    },
    {
      name: 'base-node1',
      icon: 'base-icon1',
      isComposite: true,
      isAbstract: true,
      properties: [
        { name: 'Prop1', default: 'xx', type: 'string' },
        { name: 'Speed', default: 22, type: 'number' },
      ],
    },
    { name: 'node2', icon: 'icon2', base: 'base-node1' },
    { name: 'node3', icon: 'icon3' },
    {
      name: 'base-node2',
      isAbstract: true,
      isComposite: false,
      icon: 'car',
      properties: [
        { name: 'baseProp1', default: 'x', type: 'string' },
        { name: 'baseProp2', default: 'y', type: 'string' },
      ],
    },
    {
      name: 'base-node3',
      isAbstract: true,
      icon: 'plane',
      properties: [
        { name: 'baseProp2', default: 2, type: 'number' },
        { name: 'baseProp3', default: 'z', type: 'string' },
        { name: 'baseProp4', default: 'w', type: 'string' },
      ],
    },
    {
      name: 'node4',
      base: ['base-node2', 'base-node3'],
      properties: [
        // no `type`: the base's type must be inherited by the merge
        { name: 'baseProp3', default: 'xy' } as PropertyDescJson,
        { name: 'baseProp4', default: 'zw', type: 'string' },
      ],
    },
  ],
};

describe('compileProject', () => {
  it('compiles inheritance, property override order and abstract removal (ported spec)', () => {
    const project = compileProject(inheritanceProject);

    expect(Object.keys(project.nodes)).toHaveLength(4);
    expect(project.nodes['base-node1']).toBeUndefined();

    const node1 = project.nodes['node1'];
    expect(node1.name).toBe('node1');
    expect(node1.icon).toBe('icon1');
    expect(node1.isComposite).toBe(true);
    expect(node1.properties).toEqual([
      { name: 'Prop1', default: 'xx', type: 'string' },
      { name: 'Speed', default: -1, type: 'number' },
      { name: 'TargetBlackboardKey', default: 'yy', type: 'string' },
    ]);

    const node2 = project.nodes['node2'];
    expect(node2.icon).toBe('icon2');
    expect(node2.properties).toEqual([
      { name: 'Prop1', default: 'xx', type: 'string' },
      { name: 'Speed', default: 22, type: 'number' },
    ]);

    const node3 = project.nodes['node3'];
    expect(node3.icon).toBe('icon3');
    expect(node3.isComposite).toBe(false);
    expect(node3.properties).toEqual([]);

    const node4 = project.nodes['node4'];
    expect(node4.icon).toBe('plane');
    expect(node4.properties).toEqual([
      { name: 'baseProp1', default: 'x', type: 'string' },
      { name: 'baseProp2', default: 2, type: 'number' },
      { name: 'baseProp3', default: 'xy', type: 'string' },
      { name: 'baseProp4', default: 'zw', type: 'string' },
    ]);
  });

  it('does not expose abstract types and keeps them usable as bases only', () => {
    const project = compileProject({
      nodes: [
        { name: 'abs', isAbstract: true, isComposite: true },
        { name: 'concrete', base: 'abs' },
      ],
    });
    expect(Object.keys(project.nodes)).toEqual(['concrete']);
    expect(project.nodes['concrete'].isComposite).toBe(true);
  });

  it('resolves a base chain (grandparent -> parent -> child)', () => {
    const project = compileProject({
      nodes: [
        { name: 'child', base: 'parent', properties: [{ name: 'c', type: 'string' }] },
        {
          name: 'parent',
          base: 'grand',
          isAbstract: true,
          properties: [{ name: 'p', type: 'number' }],
        },
        { name: 'grand', isAbstract: true, properties: [{ name: 'g', type: 'bool' }] },
      ],
    });
    expect(project.nodes['child'].properties.map((p) => p.name)).toEqual(['g', 'p', 'c']);
  });

  it('does not depend on declaration order', () => {
    const project = compileProject({
      nodes: [
        { name: 'child', base: 'parent' },
        {
          name: 'parent',
          isAbstract: true,
          icon: 'parent-icon',
          properties: [{ name: 'p', type: 'string' }],
        },
      ],
    });
    expect(project.nodes['child'].icon).toBe('parent-icon');
    expect(project.nodes['child'].properties).toEqual([{ name: 'p', type: 'string' }]);
  });

  it('lets the derived type override base fields like icon and isComposite', () => {
    const project = compileProject({
      nodes: [
        { name: 'base', isAbstract: true, isComposite: true, icon: 'base-icon' },
        { name: 'derived', base: 'base', isComposite: false, icon: 'own' },
      ],
    });
    expect(project.nodes['derived'].icon).toBe('own');
    expect(project.nodes['derived'].isComposite).toBe(false);
  });

  it('throws for a missing base type', () => {
    expect(() => compileProject({ nodes: [{ name: 'x', base: 'nope' }] })).toThrow(
      "Missing base type 'nope' for 'x'",
    );
  });

  it('throws for a missing base in an array of bases', () => {
    expect(() =>
      compileProject({
        services: [
          { name: 'a', isAbstract: true },
          { name: 'x', base: ['a', 'missing'] },
        ],
      }),
    ).toThrow("Missing base type 'missing' for 'x'");
  });

  it('throws on a cyclic inheritance and mentions the cycle', () => {
    expect(() =>
      compileProject({
        decorators: [
          { name: 'a', base: 'b' },
          { name: 'b', base: 'a' },
        ],
      }),
    ).toThrow(/Cyclic inheritance: .*a.*b/);
  });

  it('throws on self inheritance', () => {
    expect(() => compileProject({ nodes: [{ name: 'a', base: 'a' }] })).toThrow(
      /Cyclic inheritance/,
    );
  });

  it('applies default colors per kind and honours explicit colors', () => {
    const project = compileProject({
      nodes: [
        { name: 'comp', isComposite: true },
        { name: 'act' },
        { name: 'custom', color: '#000000' },
      ],
      decorators: [{ name: 'dec' }],
      services: [{ name: 'svc' }],
    });
    expect(project.nodes['comp'].color).toBe(DEFAULT_COLORS.composite);
    expect(project.nodes['act'].color).toBe(DEFAULT_COLORS.action);
    expect(project.nodes['custom'].color).toBe('#000000');
    expect(project.decorators['dec'].color).toBe(DEFAULT_COLORS.decorator);
    expect(project.services['svc'].color).toBe(DEFAULT_COLORS.service);
  });

  it('sets kind, isComposite=false for sub items and ignores isComposite for them', () => {
    const project = compileProject({
      decorators: [{ name: 'dec', isComposite: true }],
      services: [{ name: 'svc' }],
      nodes: [{ name: 'n' }],
    });
    expect(project.decorators['dec'].kind).toBe('decorator');
    expect(project.decorators['dec'].isComposite).toBe(false);
    expect(project.services['svc'].kind).toBe('service');
    expect(project.nodes['n'].kind).toBe('node');
  });

  it('resolves custom types with pattern and keeps the custom type name', () => {
    const project = compileProject({
      types: {
        myString: { type: 'string', pattern: '[a-z]+' },
        myNumber: { type: 'number' },
      },
      nodes: [
        {
          name: 'n',
          properties: [
            { name: 'a', type: 'myString', default: 'abc' },
            { name: 'b', type: 'myNumber', min: 0 },
          ],
        },
      ],
    });
    const [a, b] = project.nodes['n'].properties;
    expect(a).toEqual({
      name: 'a',
      type: 'string',
      customType: 'myString',
      pattern: '[a-z]+',
      default: 'abc',
    });
    expect(b).toEqual({ name: 'b', type: 'number', customType: 'myNumber', min: 0 });
    expect(b.pattern).toBeUndefined();
  });

  it('falls back to string for an unknown custom type', () => {
    const project = compileProject({
      nodes: [{ name: 'n', properties: [{ name: 'a', type: 'mystery' }] }],
    });
    expect(project.nodes['n'].properties[0]).toEqual({
      name: 'a',
      type: 'string',
      customType: 'mystery',
    });
  });

  it('keeps enum values, min/max and descriptions of base types', () => {
    const project = compileProject({
      nodes: [
        {
          name: 'n',
          properties: [
            { name: 'e', type: 'enum', values: ['x', 'y'], default: 'x', description: 'an enum' },
            { name: 'm', type: 'number', min: 1, max: 5 },
          ],
        },
      ],
    });
    expect(project.nodes['n'].properties).toEqual([
      { name: 'e', type: 'enum', values: ['x', 'y'], default: 'x', description: 'an enum' },
      { name: 'm', type: 'number', min: 1, max: 5 },
    ]);
  });

  it('does not treat prototype member names as custom types', () => {
    const project = compileProject({
      nodes: [{ name: 'n', properties: [{ name: 'a', type: 'constructor' }] }],
    });
    expect(project.nodes['n'].properties[0]).toEqual({
      name: 'a',
      type: 'string',
      customType: 'constructor',
    });
  });

  it('keeps description and icon on compiled types', () => {
    const project = compileProject({
      nodes: [{ name: 'n', icon: 'i', description: 'Wait {{ Time }}' }],
    });
    expect(project.nodes['n'].icon).toBe('i');
    expect(project.nodes['n'].description).toBe('Wait {{ Time }}');
  });

  it('handles an empty project', () => {
    expect(compileProject({})).toEqual({ nodes: {}, decorators: {}, services: {} });
  });
});

describe('getItemType', () => {
  const project = compileProject({
    nodes: [{ name: 'Seq', isComposite: true }],
    decorators: [{ name: 'Inv' }],
    services: [{ name: 'Log' }],
  });

  it('returns the compiled type when it exists', () => {
    expect(getItemType(project, 'node', 'Seq').name).toBe('Seq');
    expect(getItemType(project, 'decorator', 'Inv').kind).toBe('decorator');
    expect(getItemType(project, 'service', 'Log').kind).toBe('service');
  });

  it('returns an invalid fallback with a default color for a missing node', () => {
    expect(getItemType(project, 'node', 'Nope')).toEqual({
      kind: 'node',
      name: 'Nope',
      icon: 'triangle-exclamation',
      color: DEFAULT_COLORS.composite,
      isComposite: true,
      properties: [],
      isInvalid: true,
    });
  });

  it('returns invalid fallbacks with kind colors for missing sub items', () => {
    const dec = getItemType(project, 'decorator', 'Nope');
    expect(dec.isInvalid).toBe(true);
    expect(dec.isComposite).toBe(false);
    expect(dec.color).toBe(DEFAULT_COLORS.decorator);

    const svc = getItemType(project, 'service', 'Nope');
    expect(svc.color).toBe(DEFAULT_COLORS.service);
  });

  it('does not resolve prototype member names', () => {
    expect(getItemType(project, 'node', 'toString').isInvalid).toBe(true);
  });
});

describe('parseAndCompileProject', () => {
  it('returns the compiled project for valid JSON', () => {
    const result = parseAndCompileProject(JSON.stringify({ nodes: [{ name: 'a' }] }));
    expect(result.error).toBeUndefined();
    expect(result.project?.nodes['a'].name).toBe('a');
  });

  it('returns an error for invalid JSON without throwing', () => {
    const result = parseAndCompileProject('{ nope');
    expect(result.project).toBeUndefined();
    expect(result.error).toBeTruthy();
  });

  it('returns an error for compile failures without throwing', () => {
    const result = parseAndCompileProject(JSON.stringify({ nodes: [{ name: 'x', base: 'y' }] }));
    expect(result.project).toBeUndefined();
    expect(result.error).toBe("Missing base type 'y' for 'x'");
  });

  it('rejects non-object JSON', () => {
    expect(parseAndCompileProject('[1,2]').error).toBeDefined();
    expect(parseAndCompileProject('null').error).toBeDefined();
    expect(parseAndCompileProject('"text"').error).toBeDefined();
  });
});
