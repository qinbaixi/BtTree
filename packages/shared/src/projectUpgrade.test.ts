import { describe, expect, it } from 'vitest';
import { addMissingBuiltins, findMissingBuiltins } from './projectUpgrade';
import type { ProjectFile } from './types';

const template: ProjectFile = {
  types: { blackboardKey: { type: 'string', pattern: '[A-Za-z_]+' }, other: { type: 'number' } },
  nodes: [
    { name: 'Selector', isComposite: true },
    { name: 'UtilitySelector', isComposite: true },
  ],
  decorators: [
    { name: 'Utility', simulate: { score: '{{Score}}' } },
    {
      name: 'Consideration',
      properties: [
        { name: 'Input', type: 'blackboardKey' },
        { name: 'Curve', type: 'enum', values: ['Linear'] },
      ],
    },
  ],
};

describe('project upgrade', () => {
  it('lists the built-in types an old project misses', () => {
    const old: ProjectFile = { nodes: [{ name: 'Selector', isComposite: true }] };
    expect(findMissingBuiltins(old, template)).toEqual([
      { kind: 'node', name: 'UtilitySelector' },
      { kind: 'decorator', name: 'Utility' },
      { kind: 'decorator', name: 'Consideration' },
    ]);
  });

  it('keeps types the project already defines, even with another definition', () => {
    const own: ProjectFile = {
      nodes: [{ name: 'UtilitySelector', isComposite: true, icon: 'star' }],
      decorators: [{ name: 'Utility' }, { name: 'Consideration' }],
    };
    expect(findMissingBuiltins(own, template)).toEqual([]);
    expect(addMissingBuiltins(own, template).project).toEqual(own);
  });

  it('appends the template definitions and the custom types they use', () => {
    const old: ProjectFile = {
      nodes: [{ name: 'Selector', isComposite: true }],
      scenarios: [{ name: 'S', blackboard: {} }],
    };
    const { project, added, addedCustomTypes } = addMissingBuiltins(old, template);
    expect(added.map((a) => a.name)).toEqual(['UtilitySelector', 'Utility', 'Consideration']);
    expect(addedCustomTypes).toEqual(['blackboardKey']);
    expect(project.types).toEqual({ blackboardKey: template.types!.blackboardKey });
    expect(project.nodes?.map((n) => n.name)).toEqual(['Selector', 'UtilitySelector']);
    expect(project.decorators?.map((n) => n.name)).toEqual(['Utility', 'Consideration']);
    expect(project.scenarios).toEqual(old.scenarios);
    // the input is not changed
    expect(old.nodes).toHaveLength(1);
    expect(old.types).toBeUndefined();
  });

  it('does not replace an existing custom type of the same name', () => {
    const old: ProjectFile = { types: { blackboardKey: { type: 'string' } } };
    const { project, addedCustomTypes } = addMissingBuiltins(old, template);
    expect(addedCustomTypes).toEqual([]);
    expect(project.types).toEqual({ blackboardKey: { type: 'string' } });
  });

  it('skips types the template does not have', () => {
    expect(findMissingBuiltins({}, { nodes: [] })).toEqual([]);
  });
});
