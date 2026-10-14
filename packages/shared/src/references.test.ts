import { describe, expect, it } from 'vitest';
import { compileProject } from './compileProject';
import { collapseRenames, findTreeUsages, rewriteTreeReferences } from './references';
import type { ProjectFile, TreeNodeJson } from './types';

const project: ProjectFile = {
  types: { blackboardKey: { type: 'string' } },
  nodes: [
    { name: 'Sequence', isComposite: true },
    { name: 'MoveTo', properties: [{ name: 'Target', type: 'blackboardKey', default: 'Enemy' }] },
    { name: 'Say', properties: [{ name: 'Text', type: 'string' }] },
  ],
  decorators: [{ name: 'IsSet', properties: [{ name: 'Field', type: 'blackboardKey' }] }],
  services: [{ name: 'Scan' }],
};

function tree(): TreeNodeJson {
  return {
    type: 'Sequence',
    label: 'Root',
    custom: { keep: true },
    services: [{ type: 'Scan' }],
    childNodes: [
      {
        type: 'MoveTo',
        label: 'Go',
        decorators: [
          { type: 'IsSet', properties: [{ name: 'Field', value: 'Waypoint' }] },
          { type: 'IsSet', properties: [{ name: 'Field', value: 'Enemy' }] },
        ],
        properties: [{ name: 'Target', value: 'Waypoint' }],
      },
      { type: 'MoveTo' },
      { type: 'Say', properties: [{ name: 'Text', value: 'Waypoint' }] },
    ],
  };
}

describe('findTreeUsages', () => {
  it('finds nodes, decorators and services of a type', () => {
    expect(findTreeUsages(tree(), { kind: 'node', name: 'MoveTo' })).toEqual([
      { nodePath: [0], itemKind: 'node', type: 'MoveTo', label: 'Go', location: 'Root › Go' },
      { nodePath: [1], itemKind: 'node', type: 'MoveTo', location: 'Root › MoveTo' },
    ]);
    expect(findTreeUsages(tree(), { kind: 'decorator', name: 'IsSet' })).toMatchObject([
      { nodePath: [0], itemKind: 'decorator', itemIndex: 0 },
      { nodePath: [0], itemKind: 'decorator', itemIndex: 1 },
    ]);
    expect(findTreeUsages(tree(), { kind: 'service', name: 'Scan' })).toMatchObject([
      { nodePath: [], itemKind: 'service', itemIndex: 0, location: 'Root' },
    ]);
    // Same name, other kind.
    expect(findTreeUsages(tree(), { kind: 'decorator', name: 'MoveTo' })).toEqual([]);
  });

  it('finds blackboard keys in blackboardKey properties, including defaults', () => {
    const compiled = compileProject(project);
    expect(
      findTreeUsages(tree(), { kind: 'blackboardKey', name: 'Waypoint' }, compiled),
    ).toMatchObject([
      { nodePath: [0], itemKind: 'node', property: 'Target' },
      { nodePath: [0], itemKind: 'decorator', itemIndex: 0, property: 'Field' },
    ]);
    const enemy = findTreeUsages(tree(), { kind: 'blackboardKey', name: 'Enemy' }, compiled);
    expect(enemy).toMatchObject([
      { nodePath: [0], itemKind: 'decorator', itemIndex: 1, property: 'Field' },
      { nodePath: [1], itemKind: 'node', property: 'Target', isDefault: true },
    ]);
    expect(enemy[0].isDefault).toBeUndefined();
    // Without the project, property types are unknown.
    expect(findTreeUsages(tree(), { kind: 'blackboardKey', name: 'Waypoint' })).toEqual([]);
  });

  it('survives malformed trees', () => {
    const bad = {
      type: 'Sequence',
      childNodes: 'x',
      decorators: [null],
    } as unknown as TreeNodeJson;
    expect(findTreeUsages(bad, { kind: 'node', name: 'Sequence' })).toHaveLength(1);
  });
});

describe('rewriteTreeReferences', () => {
  it('renames types of the matching kind only and keeps unknown fields', () => {
    const json = tree();
    const count = rewriteTreeReferences(json, [
      { kind: 'node', from: 'MoveTo', to: 'Walk' },
      { kind: 'decorator', from: 'IsSet', to: 'HasKey' },
      { kind: 'service', from: 'MoveTo', to: 'Nope' },
    ]);
    expect(count).toBe(4);
    expect(json.childNodes?.[0].type).toBe('Walk');
    expect(json.childNodes?.[1].type).toBe('Walk');
    expect(json.childNodes?.[0].decorators?.map((d) => d.type)).toEqual(['HasKey', 'HasKey']);
    expect(json.custom).toEqual({ keep: true });
  });

  it('swaps names in one pass', () => {
    const json: TreeNodeJson = { type: 'A', childNodes: [{ type: 'B' }] };
    rewriteTreeReferences(json, [
      { kind: 'node', from: 'A', to: 'B' },
      { kind: 'node', from: 'B', to: 'A' },
    ]);
    expect(json).toEqual({ type: 'B', childNodes: [{ type: 'A' }] });
  });

  it('renames explicit blackboard key values with the renamed types', () => {
    const renamed: ProjectFile = JSON.parse(JSON.stringify(project)) as ProjectFile;
    renamed.nodes![1].name = 'Walk';
    const json = tree();
    const count = rewriteTreeReferences(
      json,
      [
        { kind: 'node', from: 'MoveTo', to: 'Walk' },
        { kind: 'blackboardKey', from: 'Waypoint', to: 'Spot' },
      ],
      compileProject(renamed),
    );
    // 2 node types + Target + Field.
    expect(count).toBe(4);
    expect(json.childNodes?.[0].properties).toEqual([{ name: 'Target', value: 'Spot' }]);
    expect(json.childNodes?.[0].decorators?.[0].properties).toEqual([
      { name: 'Field', value: 'Spot' },
    ]);
    // A plain string property is left alone, and so is a default (no value in the tree).
    expect(json.childNodes?.[2].properties).toEqual([{ name: 'Text', value: 'Waypoint' }]);
    expect(json.childNodes?.[1].properties).toBeUndefined();
  });

  it('changes nothing without matches', () => {
    const json = tree();
    expect(rewriteTreeReferences(json, [{ kind: 'node', from: 'X', to: 'Y' }])).toBe(0);
    expect(json).toEqual(tree());
  });
});

describe('collapseRenames', () => {
  it('chains and drops reverted renames', () => {
    expect(
      collapseRenames([
        { kind: 'node', from: 'A', to: 'B' },
        { kind: 'node', from: 'B', to: 'C' },
        { kind: 'decorator', from: 'X', to: 'Y' },
        { kind: 'decorator', from: 'Y', to: 'X' },
        { kind: 'blackboardKey', from: 'K', to: 'K' },
        { kind: 'service', from: 'B', to: 'D' },
      ]),
    ).toEqual([
      { kind: 'node', from: 'A', to: 'C' },
      { kind: 'service', from: 'B', to: 'D' },
    ]);
  });
});
