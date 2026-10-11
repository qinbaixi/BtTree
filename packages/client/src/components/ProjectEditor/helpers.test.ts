import { describe, expect, it } from 'vitest';
import type { ProjectFile, ProjectIssue } from '@owlbt/shared';
import { projectEditorUrl, parseTypeParam } from '../../lib/appNavigation';
import { countIssuesByType, selectionForPath, typeOfPath, unknownPlaceholders } from './issues';
import { countCustomTypeUses, testPattern } from './CustomTypesView';
import { setExportField } from './ExportSettingsView';
import { defaultColorFor, formatExportValue, parseExportValue } from './TypeForm';
import { valueTypeOf } from './PropertyTable';
import { buildPreview, STAND_IN_NODE } from './TypePreview';
import { buildGroups } from './TypeList';

const FILE: ProjectFile = {
  types: { key: { type: 'string', pattern: '[a-z]+' }, count: { type: 'number' } },
  nodes: [
    { name: 'Selector', isComposite: true, properties: [{ name: 'k', type: 'key' }] },
    { name: 'Wait', base: 'Selector', description: 'Waits {{duration}} {{ Mode }} {{Mode}}' },
    { name: 'Action' },
  ],
  decorators: [{ name: 'Inverter' }],
  services: [],
};

describe('issue helpers', () => {
  it('maps paths to types and custom types', () => {
    expect(typeOfPath(FILE, 'nodes[1].base')).toEqual({ kind: 'node', name: 'Wait' });
    expect(typeOfPath(FILE, 'decorators[0].name')).toEqual({ kind: 'decorator', name: 'Inverter' });
    expect(typeOfPath(FILE, 'nodes[9].name')).toBeUndefined();
    expect(selectionForPath(FILE, 'types.key.pattern')).toEqual({ view: 'custom', name: 'key' });
    expect(selectionForPath(FILE, 'services[0].name')).toBeUndefined();
  });

  it('counts errors and warnings per type', () => {
    const issues: ProjectIssue[] = [
      { path: 'nodes[1].base', message: 'x', severity: 'error' },
      { path: 'nodes[1].properties[0].type', message: 'y', severity: 'warning' },
      { path: 'types.key.type', message: 'z', severity: 'error' },
    ];
    const counts = countIssuesByType(FILE, issues);
    expect(counts.get('node:Wait')).toEqual({ errors: 1, warnings: 1 });
    expect(counts.has('node:Selector')).toBe(false);
  });

  it('finds placeholders without a matching property', () => {
    expect(unknownPlaceholders('{{duration}} {{ Mode }} {{Mode}} {{Speed}}', ['Mode'])).toEqual([
      'duration',
      'Speed',
    ]);
  });
});

describe('navigation helpers', () => {
  it('builds the editor URL with optional from and type', () => {
    expect(projectEditorUrl({ path: '/a/owl-bt.json' })).toBe('/project?path=%2Fa%2Fowl-bt.json');
    const url = projectEditorUrl({
      path: '/a/t.json',
      from: '/a/t.json',
      type: { kind: 'decorator', name: 'Inverter' },
    });
    expect(new URL(url, 'http://x').searchParams.get('type')).toBe('decorator:Inverter');
    expect(new URL(url, 'http://x').searchParams.get('from')).toBe('/a/t.json');
  });

  it('parses the type parameter and rejects malformed values', () => {
    expect(parseTypeParam('service:Logger')).toEqual({ kind: 'service', name: 'Logger' });
    expect(parseTypeParam('node:A:B')).toEqual({ kind: 'node', name: 'A:B' });
    expect(parseTypeParam('bogus:A')).toBeUndefined();
    expect(parseTypeParam('node:')).toBeUndefined();
    expect(parseTypeParam('node')).toBeUndefined();
    expect(parseTypeParam(null)).toBeUndefined();
  });
});

describe('editor helpers', () => {
  it('tests custom type patterns against whole values', () => {
    expect(testPattern('[a-z]+', 'abc')).toBe('match');
    expect(testPattern('[a-z]+', 'abc1')).toBe('no-match');
    expect(testPattern('(', 'x')).toBe('invalid');
    expect(testPattern(undefined, 'x')).toBe('none');
    expect(testPattern('[a-z]+', '')).toBe('none');
  });

  it('counts properties that use a custom type', () => {
    expect(countCustomTypeUses(FILE, 'key')).toBe(1);
    expect(countCustomTypeUses(FILE, 'count')).toBe(0);
  });

  it('keeps the value types of properties', () => {
    expect(valueTypeOf('enum', {})).toBe('enum');
    expect(valueTypeOf('count', FILE.types ?? {})).toBe('number');
    expect(valueTypeOf('key', FILE.types ?? {})).toBe('string');
    expect(valueTypeOf('mystery', FILE.types ?? {})).toBe('string');
  });

  it('parses export field values as JSON when possible', () => {
    expect(parseExportValue('42')).toBe(42);
    expect(parseExportValue('[1,2]')).toEqual([1, 2]);
    expect(parseExportValue('plain text')).toBe('plain text');
    expect(formatExportValue('x')).toBe('x');
    expect(formatExportValue(42)).toBe('42');
  });

  it('uses the default colors per kind', () => {
    expect(defaultColorFor('node', true)).toBe('#d08038');
    expect(defaultColorFor('node', false)).toBe('#955cc6');
    expect(defaultColorFor('decorator', false)).toBe('#5c90c6');
    expect(defaultColorFor('service', false)).toBe('#5cc690');
  });

  it('sets and clears export fields and drops empty formats', () => {
    const file: ProjectFile = {};
    setExportField(file, 'lua', 'outDir', 'out/lua');
    setExportField(file, 'cs', 'namespace', 'Game.AI');
    expect(file.export).toEqual({ lua: { outDir: 'out/lua' }, cs: { namespace: 'Game.AI' } });
    setExportField(file, 'cs', 'namespace', undefined);
    setExportField(file, 'lua', 'outDir', undefined);
    expect(file).toEqual({});
  });

  it('groups the list by kind, with the filter applied to names', () => {
    const groups = buildGroups(FILE, 'a');
    expect(groups.map((g) => [g.id, g.rows.map((r) => r.name)])).toEqual([
      ['composite', []],
      ['action', ['Wait', 'Action']],
      ['decorator', []],
      ['service', []],
    ]);
    expect(groups[1].total).toBe(2);
    expect(groups[0].total).toBe(1);
  });

  it('builds a preview for decorators on a stand-in node when the project has no composite', () => {
    const model = buildPreview({ decorators: [{ name: 'Inverter' }] }, 'decorator', 'Inverter');
    expect('error' in model).toBe(false);
    if ('error' in model) {
      return;
    }
    expect(model.standIn).toBe(true);
    expect(model.hostType).toBe(STAND_IN_NODE);
    expect(model.project.nodes[STAND_IN_NODE].isComposite).toBe(true);
  });

  it('previews abstract types and reports types that do not compile', () => {
    const abstract = buildPreview({ nodes: [{ name: 'A', isAbstract: true }] }, 'node', 'A');
    expect('type' in abstract && abstract.type.name).toBe('A');
    const broken = buildPreview({ nodes: [{ name: 'A', base: 'Gone' }] }, 'node', 'A');
    expect('error' in broken && broken.error).toBe("Missing base type 'Gone' for 'A'");
  });
});
