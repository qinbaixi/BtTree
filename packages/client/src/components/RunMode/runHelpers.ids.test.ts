import { describe, expect, it } from 'vitest';
import {
  compileProject,
  createIdGen,
  nodeFromJson,
  numberTree,
  type LogEntry,
} from '@owlbt/shared';
import { buildExportIdMap, describeWithOverrides, entryInfo, nodeInfo } from './runHelpers';

const project = compileProject({
  nodes: [
    { name: 'Sequence', isComposite: true },
    {
      name: 'Fire',
      description: 'Attack with {{Shots}} shots',
      properties: [{ name: 'Shots', type: 'number', default: 1 }],
    },
    { name: 'Plain' },
  ],
  decorators: [
    {
      name: 'Guard',
      description: 'needs {{Key}}',
      properties: [{ name: 'Key', type: 'string' }],
    },
  ],
  services: [{ name: 'Scan' }],
});

const root = nodeFromJson(
  {
    type: 'Sequence',
    decorators: [{ type: 'Guard', properties: [{ name: 'Key', value: 'Ammo' }] }],
    childNodes: [
      {
        type: 'Fire',
        label: 'Shoot',
        services: [{ type: 'Scan', label: 'radar' }],
        decorators: [{ type: 'Guard' }],
        properties: [{ name: 'Shots', value: 3 }],
        childNodes: [{ type: 'Plain' }],
      },
      { type: 'Plain' },
    ],
  } as never,
  createIdGen('h'),
);
const fire = root.childNodes[0];

describe('buildExportIdMap', () => {
  it('matches numberTree, with sub items and root = 1', () => {
    const ids = buildExportIdMap(root);
    const numbered = numberTree(root);
    expect(ids.size).toBe(numbered.length);
    for (const item of numbered) expect(ids.get(item.item.id)).toBe(item.id);
    expect(ids.get(root.id)).toBe(1);
    // root, its decorator, then the child's decorator / service / node.
    expect(ids.get(root.decorators[0].id)).toBe(2);
    expect(ids.get(fire.decorators[0].id)).toBe(3);
    expect(ids.get(fire.services[0].id)).toBe(4);
    expect(ids.get(fire.id)).toBe(5);
    expect(buildExportIdMap(undefined).size).toBe(0);
  });
});

describe('descriptions with overrides', () => {
  const ids = buildExportIdMap(root);

  it('describes a node with its effective values and label / type', () => {
    expect(nodeInfo(root, project, ids, undefined, fire.id)).toEqual({
      exportId: 5,
      name: 'Shoot',
      type: 'Fire',
      description: 'Attack with 3 shots',
    });
  });

  it('applies run overrides to the description', () => {
    const overrides = { [fire.id]: { Shots: 9 } };
    expect(nodeInfo(root, project, ids, overrides, fire.id).description).toBe(
      'Attack with 9 shots',
    );
    expect(describeWithOverrides(project, 'node', 'Fire', fire.id, fire.properties, {})).toBe(
      'Attack with 3 shots',
    );
  });

  it('omits a missing description and handles unknown nodes', () => {
    const plain = root.childNodes[1];
    const info = nodeInfo(root, project, ids, undefined, plain.id);
    expect(info).toEqual({ exportId: ids.get(plain.id), name: 'Plain' });
    expect(nodeInfo(root, project, ids, undefined, 'zz')).toEqual({ name: 'zz' });
  });

  it('uses the sub item id and values for decorator / service entries', () => {
    const entry = (itemId: string, nodeId = root.id): LogEntry => ({
      tick: 1,
      nodeId,
      itemId,
      message: 'x',
      kind: 'decorator',
    });
    expect(entryInfo(root, project, ids, undefined, entry(root.decorators[0].id))).toEqual({
      exportId: 2,
      name: 'Guard',
      description: 'needs Ammo',
    });
    expect(entryInfo(root, project, ids, undefined, entry(fire.services[0].id, fire.id))).toEqual({
      exportId: 4,
      name: 'radar',
      type: 'Scan',
    });
  });
});
