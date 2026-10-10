import { describe, expect, it } from 'vitest';
import { compileProject } from '../compileProject';
import { createIdGen, nodeFromJson } from '../treeModel';
import type { ProjectFile, TreeNodeJson } from '../types';
import { buildExportModel } from './buildExportModel';
import { ExportError, type ExportEntry, type ExportValue } from './model';

const PROJECT: ProjectFile = {
  nodes: [
    { name: 'Selector', isComposite: true },
    {
      name: 'RandomSelector',
      isComposite: true,
      export: { fields: { priority: 1, tags: ['a'], meta: { x: 'y' } } },
    },
    { name: 'Walk', export: { type: 'action', subType: 'walk_to' } },
    {
      name: 'Wait',
      properties: [
        { name: 'duration', type: 'number', default: 100 },
        {
          name: 'mode',
          type: 'enum',
          values: ['Like This', 'Other'],
          default: 'Like This',
          exportName: 'mode_name',
        },
        { name: 'note', type: 'string', exportTo: 'node' },
      ],
    },
    { name: 'Bare' },
  ],
  decorators: [
    {
      name: 'Inv',
      export: { subType: 3 },
      properties: [{ name: 'abort_mode', type: 'number', default: 0, exportTo: 'node' }],
    },
  ],
  services: [
    {
      name: 'Log',
      export: { subType: 'log' },
      properties: [{ name: 'rate', type: 'number', min: 0, max: 10 }],
    },
  ],
};

const compiled = compileProject(PROJECT);

function build(json: TreeNodeJson) {
  return buildExportModel(nodeFromJson(json, createIdGen()), compiled);
}

function entryOf(model: ReturnType<typeof build>, id: number): ExportEntry {
  const entry = model.entries.find((e) => e.id === id);
  if (!entry) {
    throw new Error(`no entry ${id}`);
  }
  return entry;
}

function fieldsOf(entry: ExportEntry): Record<string, ExportValue> {
  return Object.fromEntries(entry.fields);
}

describe('buildExportModel', () => {
  it('exports a composite node with its id lists and no properties when none are declared', () => {
    const model = build({ type: 'Selector', childNodes: [{ type: 'Bare' }] });
    const entry = entryOf(model, 1);
    expect(entry.comment).toBe('Selector');
    expect(entry.fields.map(([key]) => key)).toEqual([
      'node_id',
      'type',
      'sub_type',
      'decorators',
      'services',
      'children',
    ]);
    expect(fieldsOf(entry)).toMatchObject({
      node_id: 1,
      type: { atom: 'composite' },
      sub_type: { atom: 'selector' },
      decorators: [],
      services: [],
      children: [2],
    });
    expect(model.rootId).toBe(1);
  });

  it('uses task for action nodes and an explicit type override', () => {
    const model = build({ type: 'Selector', childNodes: [{ type: 'Bare' }, { type: 'Walk' }] });
    expect(fieldsOf(entryOf(model, 2)).type).toEqual({ atom: 'task' });
    expect(fieldsOf(entryOf(model, 3)).type).toEqual({ atom: 'action' });
    expect(fieldsOf(entryOf(model, 3)).sub_type).toEqual({ atom: 'walk_to' });
  });

  it('derives sub_type from the type name in snake_case and keeps numeric overrides', () => {
    const model = build({ type: 'RandomSelector' });
    expect(fieldsOf(entryOf(model, 1)).sub_type).toEqual({ atom: 'random_selector' });
    const numeric: ProjectFile = {
      nodes: [{ name: 'Leaf', export: { subType: 27 } }],
    };
    const root = nodeFromJson({ type: 'Leaf' }, createIdGen());
    const out = buildExportModel(root, compileProject(numeric));
    expect(fieldsOf(out.entries[0]).sub_type).toBe(27);
    expect(fieldsOf(out.entries[0]).type).toEqual({ atom: 'task' });
  });

  it('appends constant fields of the type after the id fields', () => {
    const model = build({ type: 'RandomSelector' });
    const entry = entryOf(model, 1);
    expect(entry.fields.slice(3).map(([key]) => key)).toEqual([
      'priority',
      'tags',
      'meta',
      'decorators',
      'services',
      'children',
    ]);
    expect(fieldsOf(entry)).toMatchObject({
      priority: 1,
      tags: ['a'],
      meta: { map: [['x', 'y']] },
    });
  });

  it('exports tasks with effective property values, enum atoms and exportName', () => {
    const model = build({
      type: 'Selector',
      childNodes: [{ type: 'Wait', properties: [{ name: 'duration', value: 5 }] }],
    });
    const wait = entryOf(model, 2);
    expect(fieldsOf(wait).properties).toEqual({
      map: [
        ['duration', 5],
        ['mode_name', { atom: 'Like This' }],
      ],
    });
    expect(model.warnings).toEqual([]);
  });

  it('skips a property that has neither a value nor a default', () => {
    const model = build({ type: 'Selector', childNodes: [{ type: 'Wait' }] });
    const wait = entryOf(model, 2);
    expect(wait.fields.map(([key]) => key)).toEqual([
      'node_id',
      'type',
      'sub_type',
      'decorators',
      'services',
      'properties',
    ]);
    expect(fieldsOf(wait).properties).toEqual({
      map: [
        ['duration', 100],
        ['mode_name', { atom: 'Like This' }],
      ],
    });
  });

  it('writes decorators with inverse_check_condition (always), periodic (when true) and node properties', () => {
    const model = build({
      type: 'Selector',
      decorators: [{ type: 'Inv', periodic: true }],
    });
    const decorator = entryOf(model, 2);
    expect(decorator.kind).toBe('decorator');
    expect(decorator.fields.map(([key]) => key)).toEqual([
      'node_id',
      'type',
      'sub_type',
      'inverse_check_condition',
      'periodic',
      'abort_mode',
      'properties',
    ]);
    expect(fieldsOf(decorator)).toMatchObject({
      type: { atom: 'decorator' },
      sub_type: 3,
      inverse_check_condition: false,
      periodic: true,
      abort_mode: 0,
      properties: { map: [] },
    });
    expect(fieldsOf(entryOf(model, 1)).node_id).toBe(1);
    expect(model.rootId).toBe(1);
  });

  it('omits periodic when it is not true and maps inverseCheckCondition', () => {
    const model = build({
      type: 'Selector',
      decorators: [{ type: 'Inv', inverseCheckCondition: true, periodic: false }],
    });
    const decorator = entryOf(model, 2);
    expect(fieldsOf(decorator).inverse_check_condition).toBe(true);
    expect(decorator.fields.some(([key]) => key === 'periodic')).toBe(false);
  });

  it('writes services with tick times when set and properties always', () => {
    const model = build({
      type: 'Selector',
      services: [
        {
          type: 'Log',
          timeBetweenTicks: 0.5,
          firstTickTime: 2,
          properties: [{ name: 'rate', value: 5 }],
        },
      ],
    });
    const service = entryOf(model, 2);
    expect(service.fields.map(([key]) => key)).toEqual([
      'node_id',
      'type',
      'sub_type',
      'time_between_ticks',
      'first_tick_time',
      'properties',
    ]);
    expect(fieldsOf(service)).toMatchObject({
      type: { atom: 'service' },
      sub_type: { atom: 'log' },
      time_between_ticks: 0.5,
      first_tick_time: 2,
      properties: { map: [['rate', 5]] },
    });
  });

  it('omits the tick times of services when they are not set', () => {
    const model = build({ type: 'Selector', services: [{ type: 'Log' }] });
    const service = entryOf(model, 2);
    expect(service.fields.some(([key]) => key === 'time_between_ticks')).toBe(false);
    expect(service.fields.some(([key]) => key === 'first_tick_time')).toBe(false);
  });

  it('lists decorator and service ids of nodes and the child ids of composites last', () => {
    const model = build({
      type: 'Selector',
      services: [{ type: 'Log' }],
      childNodes: [{ type: 'Bare', decorators: [{ type: 'Inv' }] }],
    });
    // Ids: root 1 (always first), service 2, decorator 3, child 4.
    const root = entryOf(model, 1);
    expect(root.fields.map(([key]) => key)).toEqual([
      'node_id',
      'type',
      'sub_type',
      'decorators',
      'services',
      'children',
    ]);
    expect(fieldsOf(root)).toMatchObject({ services: [2], children: [4] });
    expect(fieldsOf(entryOf(model, 4))).toMatchObject({ decorators: [3] });
  });

  it('uses the label, then the comment, for the entry comment', () => {
    const model = build({
      type: 'Selector',
      label: 'Root\nline two',
      childNodes: [{ type: 'Bare', comment: 'just a note' }, { type: 'Bare' }],
    });
    expect(entryOf(model, 1).comment).toBe('Selector - Root line two');
    expect(entryOf(model, 2).comment).toBe('Bare - just a note');
    expect(entryOf(model, 3).comment).toBe('Bare');
  });

  it('reports invalid property values as warnings and still exports them', () => {
    const model = build({
      type: 'Selector',
      childNodes: [{ type: 'Wait', properties: [{ name: 'duration', value: 'soon' }] }],
    });
    expect(model.warnings).toEqual(["root.childNodes[0]: invalid value for property 'duration'"]);
    expect(fieldsOf(entryOf(model, 2)).properties).toMatchObject({
      map: [
        ['duration', 'soon'],
        ['mode_name', { atom: 'Like This' }],
      ],
    });
  });

  it('throws an ExportError naming the missing type and its path', () => {
    expect(() => build({ type: 'Selector', childNodes: [{ type: 'Nope' }] })).toThrow(
      new ExportError("Missing node type 'Nope' at root.childNodes[0]"),
    );
    expect(() => build({ type: 'Selector', services: [{ type: 'Gone' }] })).toThrow(
      "Missing service type 'Gone' at root.services[0]",
    );
    expect(() => build({ type: 'Selector', decorators: [{ type: 'Gone' }] })).toThrow(
      "Missing decorator type 'Gone' at root.decorators[0]",
    );
  });

  it('throws for a root without a type', () => {
    expect(() => build({} as TreeNodeJson)).toThrow(ExportError);
  });
});
