import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectMissingTypes,
  findTreeUsages,
  getEffectiveValue,
  isUndeclaredBlackboardKey,
  compileProject,
  createIdGen,
  getItemType,
  isTreeValid,
  nodeFromJson,
  type ProjectFile,
  type TreeNodeJson,
  validateProjectFile,
} from '@owlbt/shared';
import { describe, expect, it } from 'vitest';
import { TEMPLATES_DIR } from './workspace';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

describe('owl-bt.json template', () => {
  const project = readJson<ProjectFile>(join(TEMPLATES_DIR, 'owl-bt.json'));

  it('compiles', () => {
    expect(() => compileProject(project)).not.toThrow();
  });

  it('declares the custom types', () => {
    expect(Object.keys(project.types ?? {})).toEqual(['blackboardKey', 'probability']);
  });

  it('defines the composites, the abstract base and the action nodes', () => {
    const compiled = compileProject(project);

    expect(compiled.nodes.Selector.isComposite).toBe(true);
    expect(compiled.nodes.Sequence.isComposite).toBe(true);
    expect(compiled.nodes.Parallel.properties.map((p) => p.name)).toEqual(['Policy']);
    expect(compiled.nodes.RandomSelector.properties.map((p) => p.name)).toEqual(['Weights']);
    expect(compiled.nodes.ActionBase).toBeUndefined();
    for (const name of [
      'Wait',
      'Log',
      'MoveTo',
      'SetBlackboardValue',
      'Succeed',
      'Fail',
      'RandomChance',
    ]) {
      expect(compiled.nodes[name], name).toBeDefined();
      expect(compiled.nodes[name].properties.map((p) => p.name)).toContain('Async');
    }
  });

  it('uses the custom types for keys and probabilities', () => {
    const compiled = compileProject(project);
    const moveTo = compiled.nodes.MoveTo;
    expect(moveTo.properties.find((p) => p.name === 'Target')).toMatchObject({
      customType: 'blackboardKey',
      pattern: '[A-Za-z_][A-Za-z0-9_]*',
    });
    expect(compiled.nodes.RandomChance.properties[1]).toMatchObject({
      name: 'Chance',
      customType: 'probability',
      type: 'number',
      default: 0.5,
    });
  });

  it('defines decorators and services', () => {
    const compiled = compileProject(project);
    expect(Object.keys(compiled.decorators).sort()).toEqual(
      [
        'Cooldown',
        'Failure',
        'Invert',
        'IsBlackboardValueSet',
        'Loop',
        'Success',
        'TimeLimit',
      ].sort(),
    );
    expect(Object.keys(compiled.services).sort()).toEqual(
      ['LogTick', 'Sample service', 'UpdateTarget'].sort(),
    );
  });

  it('gives the color to two types and leaves the others on defaults', () => {
    const compiled = compileProject(project);
    expect(compiled.nodes.RandomSelector.color).toBe('#c6a35c');
    expect(compiled.decorators.Loop.color).toBe('#6fa8c6');
    expect(compiled.nodes.Selector.color).toBe('#d08038');
    expect(compiled.nodes.Wait.color).toBe('#955cc6');
  });
});

describe('example-tree.json template', () => {
  const project = compileProject(readJson<ProjectFile>(join(TEMPLATES_DIR, 'owl-bt.json')));
  const json = readJson<TreeNodeJson>(join(TEMPLATES_DIR, 'example-tree.json'));

  it('uses only types that exist in owl-bt.json', () => {
    const root = nodeFromJson(json, createIdGen());
    expect(collectMissingTypes(root, project)).toEqual({ nodes: [], decorators: [], services: [] });
  });

  it('is a valid tree with labels, comments, decorators and services', () => {
    const root = nodeFromJson(json, createIdGen());
    expect(isTreeValid(root, project)).toBe(true);

    const all: string[] = [];
    const walk = (node: typeof root): void => {
      all.push(node.type);
      node.childNodes.forEach(walk);
    };
    walk(root);
    expect(all.length).toBeGreaterThanOrEqual(12);

    expect(root.label).toBe('Root');
    expect(json.childNodes?.[0].comment).toBeTruthy();
    expect(json.childNodes?.[0].decorators?.[0].type).toBe('IsBlackboardValueSet');
    expect(json.childNodes?.[0].childNodes?.[0].decorators?.[0].periodic).toBe(true);
    expect(json.childNodes?.[0].childNodes?.[0].decorators?.[0].type).toBe('Cooldown');
    expect(
      json.childNodes?.[1].childNodes?.[2].childNodes?.[1].decorators?.[0].inverseCheckCondition,
    ).toBe(true);
    expect(json.services?.[0].timeBetweenTicks).toBeGreaterThan(0);
    expect(json.childNodes?.[1].services?.[0].timeBetweenTicks).toBeGreaterThan(0);
  });

  it('declares every blackboard key it uses', () => {
    expect((project.blackboard ?? []).map((key) => key.name)).toEqual([
      'Target',
      'Enemy',
      'Waypoint',
      'PatrolPoints',
      'PatrolIndex',
    ]);
    const root = nodeFromJson(json, createIdGen());
    let checked = 0;
    const check = (node: typeof root): void => {
      const items = [
        { kind: 'node' as const, item: node },
        ...node.decorators.map((item) => ({ kind: 'decorator' as const, item })),
        ...node.services.map((item) => ({ kind: 'service' as const, item })),
      ];
      for (const { kind, item } of items) {
        for (const prop of getItemType(project, kind, item.type).properties) {
          if (prop.customType === 'blackboardKey') {
            checked++;
            const value = getEffectiveValue(prop, item.properties);
            expect(isUndeclaredBlackboardKey(project, prop, value), String(value)).toBe(false);
          }
        }
      }
      node.childNodes.forEach(check);
    };
    check(root);
    expect(checked).toBeGreaterThan(4);
    expect(findTreeUsages(json, { kind: 'blackboardKey', name: 'Enemy' }, project)).toHaveLength(3);
  });

  it('resolves every node type to a real descriptor', () => {
    const root = nodeFromJson(json, createIdGen());
    const check = (node: typeof root): void => {
      expect(getItemType(project, 'node', node.type).isInvalid).toBeFalsy();
      node.childNodes.forEach(check);
    };
    check(root);
  });
});

describe('samples/basic', () => {
  it('still compiles', () => {
    const file = readJson<ProjectFile>(join(repoRoot, 'samples', 'basic', 'owl-bt.json'));
    expect(() => compileProject(file)).not.toThrow();
  });
});

describe('owl-bt.json template simulation rules', () => {
  const project = readJson<ProjectFile>(join(TEMPLATES_DIR, 'owl-bt.json'));

  it('has valid blackboard declarations', () => {
    expect(
      validateProjectFile(project).filter((issue) => issue.path.startsWith('blackboard')),
    ).toEqual([]);
  });

  it('has valid simulate settings', () => {
    expect(validateProjectFile(project).filter((issue) => issue.path.includes('simulate'))).toEqual(
      [],
    );
  });

  it('simulates the built-in nodes and decorators', () => {
    const compiled = compileProject(project);
    expect(compiled.nodes.Wait.simulate).toMatchObject({ mode: 'rule', duration: '{{Duration}}' });
    expect(compiled.nodes.Succeed.simulate?.mode).toBe('success');
    expect(compiled.nodes.Fail.simulate?.mode).toBe('failure');
    expect(compiled.nodes.RandomChance.simulate).toBeUndefined();
    expect(compiled.decorators.Invert.simulate?.decorator).toBe('invert');
    expect(compiled.decorators.Cooldown.simulate?.decorator).toBe('cooldown');
    expect(compiled.decorators.Loop.simulate?.decorator).toBe('loop');
  });
});
