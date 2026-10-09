import { describe, expect, it } from 'vitest';
import {
  cloneNode,
  cloneSubItem,
  createIdGen,
  nodeFromJson,
  nodeToJson,
  serializeTree,
  subItemFromJson,
  subItemToJson,
} from './treeModel';
import type { SubItemJson, TreeNodeJson } from './types';

const sampleJson: TreeNodeJson = {
  type: 'Sequence',
  name: 'root',
  label: 'Main',
  comment: 'the root',
  futureNodeField: { deep: [1, 2, { x: null }] },
  properties: [{ name: 'Speed', value: 3 }],
  decorators: [
    {
      type: 'Inverter',
      periodic: true,
      inverseCheckCondition: false,
      customDecField: 'dec',
      properties: [{ name: 'Cond', value: 'a' }],
    },
  ],
  services: [
    {
      type: 'Logger',
      timeBetweenTicks: 0.5,
      firstTickTime: 1,
      label: 'log',
      serviceExtra: 42,
    },
  ],
  childNodes: [
    {
      type: 'Action',
      name: 'child',
      comment: 'leaf',
      unknownChildField: ['a', 'b'],
      properties: [
        { name: 'Target', value: 'enemy' },
        { name: 'Power', value: 0 },
      ],
      decorators: [{ type: 'Limiter', extraDec: { nested: true } }],
      services: [{ type: 'Timer', comment: 'svc-comment' }],
      childNodes: [{ type: 'Leaf', name: 'deepest', tag: 'x' }],
    },
  ],
};

describe('createIdGen', () => {
  it('generates unique incrementing ids with default prefix', () => {
    const gen = createIdGen();
    expect([gen(), gen(), gen()]).toEqual(['n1', 'n2', 'n3']);
  });

  it('uses the given prefix and keeps separate counters per generator', () => {
    const a = createIdGen('a');
    const b = createIdGen('b');
    expect(a()).toBe('a1');
    expect(b()).toBe('b1');
    expect(a()).toBe('a2');
  });
});

describe('nodeFromJson', () => {
  it('maps known fields and puts unknown keys (incl. name) into extra', () => {
    const node = nodeFromJson({ type: 'Seq', name: 'root', label: 'L', foo: 1 }, createIdGen());
    expect(node.type).toBe('Seq');
    expect(node.label).toBe('L');
    expect(node.extra).toEqual({ name: 'root', foo: 1 });
    expect(node.properties).toEqual({});
    expect(node.decorators).toEqual([]);
    expect(node.services).toEqual([]);
    expect(node.childNodes).toEqual([]);
  });

  it('converts property arrays to records', () => {
    const node = nodeFromJson(
      {
        type: 'A',
        properties: [
          { name: 'x', value: 1 },
          { name: 'y', value: 'two' },
        ],
      },
      createIdGen(),
    );
    expect(node.properties).toEqual({ x: 1, y: 'two' });
  });

  it('drops keys starting with $ from extra', () => {
    const node = nodeFromJson({ type: 'A', $internal: 1, keep: 2 } as TreeNodeJson, createIdGen());
    expect(node.extra).toEqual({ keep: 2 });
  });

  it('assigns unique ids to the node and all descendants', () => {
    const node = nodeFromJson(sampleJson, createIdGen('x'));
    const ids = [
      node.id,
      node.decorators[0].id,
      node.services[0].id,
      node.childNodes[0].id,
      node.childNodes[0].decorators[0].id,
      node.childNodes[0].services[0].id,
      node.childNodes[0].childNodes[0].id,
    ];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith('x'))).toBe(true);
  });

  it('defaults a missing type to unknown', () => {
    expect(nodeFromJson({ type: '' }, createIdGen()).type).toBe('unknown');
  });

  it('keeps sub item known fields on the sub item and extra separately', () => {
    const item = subItemFromJson(
      {
        type: 'Inv',
        periodic: true,
        timeBetweenTicks: 2,
        firstTickTime: 0,
        comment: 'c',
        other: 'o',
      },
      createIdGen(),
    );
    expect(item.periodic).toBe(true);
    expect(item.timeBetweenTicks).toBe(2);
    expect(item.firstTickTime).toBe(0);
    expect(item.comment).toBe('c');
    expect(item.extra).toEqual({ other: 'o' });
  });
});

describe('nodeToJson / subItemToJson', () => {
  it('omits undefined/null fields, empty arrays and empty properties', () => {
    const node = nodeFromJson({ type: 'A', properties: [] }, createIdGen());
    expect(nodeToJson(node)).toEqual({ type: 'A' });
  });

  it('converts a properties record to an array and skips undefined values', () => {
    const node = nodeFromJson({ type: 'A' }, createIdGen());
    node.properties = { a: 1, b: undefined, c: null };
    expect(nodeToJson(node).properties).toEqual([
      { name: 'a', value: 1 },
      { name: 'c', value: null },
    ]);
  });

  it('writes keys in the documented order: type, extra, label, comment, ..., properties, decorators, services, childNodes', () => {
    const node = nodeFromJson(
      {
        childNodes: [{ type: 'c' }],
        services: [{ type: 's' }],
        decorators: [{ type: 'd' }],
        properties: [{ name: 'p', value: 1 }],
        comment: 'cm',
        label: 'lb',
        zeta: 1,
        type: 'T',
      },
      createIdGen(),
    );
    expect(Object.keys(nodeToJson(node))).toEqual([
      'type',
      'zeta',
      'label',
      'comment',
      'properties',
      'decorators',
      'services',
      'childNodes',
    ]);
  });

  it('writes sub item keys in order: type, extra, label, comment, periodic, inverseCheckCondition, timeBetweenTicks, firstTickTime, properties', () => {
    const item = subItemFromJson(
      {
        properties: [{ name: 'p', value: 'v' }],
        firstTickTime: 3,
        timeBetweenTicks: 4,
        inverseCheckCondition: true,
        periodic: false,
        comment: 'c',
        label: 'l',
        ex: 'e',
        type: 'Dec',
      },
      createIdGen(),
    );
    expect(Object.keys(subItemToJson(item))).toEqual([
      'type',
      'ex',
      'label',
      'comment',
      'periodic',
      'inverseCheckCondition',
      'timeBetweenTicks',
      'firstTickTime',
      'properties',
    ]);
  });

  it('keeps periodic=false (it is a value, not an empty field)', () => {
    const item = subItemFromJson({ type: 'Dec', periodic: false }, createIdGen());
    expect(subItemToJson(item)).toEqual({ type: 'Dec', periodic: false });
  });
});

describe('round trip', () => {
  it('nodeFromJson -> nodeToJson keeps unknown fields at all levels unchanged (deep equal)', () => {
    const node = nodeFromJson(sampleJson, createIdGen());
    expect(nodeToJson(node)).toEqual(sampleJson);
  });

  it('keeps unknown fields of sub items unchanged', () => {
    const json: SubItemJson = {
      type: 'S',
      weird: { a: [1, { b: 'c' }] },
      properties: [{ name: 'k', value: 1 }],
    };
    expect(subItemToJson(subItemFromJson(json, createIdGen()))).toEqual(json);
  });

  it('serializeTree produces tab-indented JSON that parses back to the same content', () => {
    const node = nodeFromJson(sampleJson, createIdGen());
    const text = serializeTree(node);
    expect(text).toContain('\n\t"type": "Sequence"');
    expect(JSON.parse(text)).toEqual(sampleJson);
  });
});

describe('ported DTO converter case', () => {
  it('converts properties of nodes and sub items and drops empty arrays and empty properties', () => {
    const node = nodeFromJson(
      {
        type: 'sequence',
        properties: [],
        decorators: [
          {
            type: 'd1',
            properties: [
              { name: 'prop1', value: 'value1' },
              { name: 'prop2', value: 'value2' },
            ],
          },
        ],
        services: [{ type: 's1', properties: [{ name: 'prop1', value: 'value1' }] }],
        childNodes: [
          {
            type: 'chn1',
            properties: [{ name: 'prop1', value: 'value1' }],
            decorators: [],
            services: [],
            childNodes: [],
          },
        ],
      },
      createIdGen(),
    );
    expect(nodeToJson(node)).toEqual({
      type: 'sequence',
      decorators: [
        {
          type: 'd1',
          properties: [
            { name: 'prop1', value: 'value1' },
            { name: 'prop2', value: 'value2' },
          ],
        },
      ],
      services: [{ type: 's1', properties: [{ name: 'prop1', value: 'value1' }] }],
      childNodes: [{ type: 'chn1', properties: [{ name: 'prop1', value: 'value1' }] }],
    });
  });
});

describe('cloneNode / cloneSubItem', () => {
  it('deep copies the node with fresh ids for it and all descendants', () => {
    const original = nodeFromJson(sampleJson, createIdGen('o'));
    const gen = createIdGen('c');
    const copy = cloneNode(original, gen);

    expect(copy).not.toBe(original);
    expect(copy.id).toBe('c1');
    expect(copy.childNodes[0]).not.toBe(original.childNodes[0]);
    expect(copy.childNodes[0].decorators[0]).not.toBe(original.childNodes[0].decorators[0]);

    const originalIds = collectIds(original);
    const copyIds = collectIds(copy);
    expect(copyIds.some((id) => originalIds.includes(id))).toBe(false);
    expect(copyIds).toHaveLength(originalIds.length);

    expect(nodeToJson(copy)).toEqual(nodeToJson(original));
  });

  it('does not share nested mutable values with the original', () => {
    const original = nodeFromJson(sampleJson, createIdGen());
    const copy = cloneNode(original, createIdGen('c'));
    (copy.extra['futureNodeField'] as { deep: unknown[] }).deep.push('mutated');
    copy.properties['Speed'] = 99;
    copy.childNodes[0].properties['Target'] = 'other';
    expect((original.extra['futureNodeField'] as { deep: unknown[] }).deep).toHaveLength(3);
    expect(original.properties['Speed']).toBe(3);
    expect(original.childNodes[0].properties['Target']).toBe('enemy');
  });

  it('cloneSubItem gives a fresh id and copies content', () => {
    const item = subItemFromJson(
      { type: 'S', properties: [{ name: 'a', value: { x: 1 } }], ex: 1 },
      createIdGen(),
    );
    const copy = cloneSubItem(item, createIdGen('z'));
    expect(copy.id).toBe('z1');
    expect(copy.id).not.toBe(item.id);
    expect(subItemToJson(copy)).toEqual(subItemToJson(item));
    expect(copy.properties['a']).not.toBe(item.properties['a']);
  });
});

function collectIds(node: ReturnType<typeof nodeFromJson>): string[] {
  const ids: string[] = [node.id];
  for (const d of node.decorators) ids.push(d.id);
  for (const s of node.services) ids.push(s.id);
  for (const c of node.childNodes) ids.push(...collectIds(c));
  return ids;
}
