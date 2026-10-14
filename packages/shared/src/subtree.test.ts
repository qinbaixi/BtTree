import { describe, expect, it } from 'vitest';
import { compileProject, getItemType } from './compileProject';
import {
  checkSubtrees,
  collectSubtreeRefs,
  expandSubtrees,
  MAX_SUBTREE_DEPTH,
  normalizeSubtreeRef,
  subtreeName,
  subtreeOwnerId,
  type SubtreeLibrary,
} from './subtree';
import { createIdGen, nodeFromJson } from './treeModel';
import { forEachNode } from './treeOps';
import type { ProjectFile, TreeNode, TreeNodeJson } from './types';

const projectFile: ProjectFile = {
  nodes: [
    { name: 'Sequence', isComposite: true },
    { name: 'Act' },
    { name: 'SubTree', subtree: true, icon: 'diagram-project' },
    { name: 'NamedRef', base: 'SubTree', properties: [{ name: 'Extra', type: 'number' }] },
  ],
};
const project = compileProject(projectFile);

function tree(json: TreeNodeJson): TreeNode {
  return nodeFromJson(json, createIdGen('n'));
}

function ref(path: string): TreeNodeJson {
  return { type: 'SubTree', properties: [{ name: 'Tree', value: path }] };
}

describe('compileProject with subtree types', () => {
  it('marks subtree types, adds the Tree property and keeps them non-composite', () => {
    const compiled = compileProject({
      nodes: [{ name: 'S', subtree: true, isComposite: true }],
    });
    expect(compiled.nodes.S.subtree).toBe(true);
    expect(compiled.nodes.S.isComposite).toBe(false);
    expect(compiled.nodes.S.properties.map((p) => p.name)).toEqual(['Tree']);
  });

  it('inherits the subtree flag and keeps a declared Tree property', () => {
    expect(project.nodes.NamedRef.subtree).toBe(true);
    expect(project.nodes.NamedRef.properties.map((p) => p.name)).toEqual(['Extra', 'Tree']);
    const own = compileProject({
      nodes: [
        { name: 'S', subtree: true, properties: [{ name: 'Tree', type: 'string', default: 'a' }] },
      ],
    });
    expect(own.nodes.S.properties).toEqual([{ name: 'Tree', type: 'string', default: 'a' }]);
  });

  it('ignores the flag on decorators and leaves other nodes alone', () => {
    const compiled = compileProject({
      nodes: [{ name: 'A' }],
      decorators: [{ name: 'D', subtree: true }],
    });
    expect(compiled.nodes.A.subtree).toBeUndefined();
    expect(compiled.decorators.D.subtree).toBeUndefined();
    expect(compiled.decorators.D.properties).toEqual([]);
  });
});

describe('normalizeSubtreeRef', () => {
  it('normalizes separators and dot segments and appends .json', () => {
    expect(normalizeSubtreeRef('trees\\common/./patrol')).toEqual({
      ref: 'trees/common/patrol.json',
    });
    expect(normalizeSubtreeRef(' trees/a/../b.JSON ')).toEqual({ ref: 'trees/b.JSON' });
  });

  it('rejects empty values and paths outside the project', () => {
    expect(normalizeSubtreeRef('')).toEqual({ error: 'empty' });
    expect(normalizeSubtreeRef(undefined)).toEqual({ error: 'empty' });
    expect(normalizeSubtreeRef('./')).toEqual({ error: 'empty' });
    expect(normalizeSubtreeRef('../x.json')).toEqual({ error: 'outside' });
    expect(normalizeSubtreeRef('a/../../x.json')).toEqual({ error: 'outside' });
    expect(normalizeSubtreeRef('/abs/x.json')).toEqual({ error: 'outside' });
    expect(normalizeSubtreeRef('C:\\x.json')).toEqual({ error: 'outside' });
  });

  it('names a tree by its file name', () => {
    expect(subtreeName('trees/common/patrol.json')).toBe('patrol');
    expect(subtreeOwnerId('n3/4/1')).toBe('n3');
    expect(subtreeOwnerId('n3')).toBe('n3');
  });
});

describe('checkSubtrees', () => {
  const library: SubtreeLibrary = {
    'trees/b.json': { tree: { type: 'Sequence', childNodes: [ref('trees/a.json')] } },
    'trees/c.json': { tree: { type: 'Sequence', childNodes: [ref('trees/d.json')] } },
    'trees/d.json': { tree: { type: 'Sequence', childNodes: [ref('trees/c.json')] } },
    'trees/ok.json': { tree: { type: 'Act' } },
    'trees/bad.json': { error: 'invalid', message: 'Invalid JSON in trees/bad.json' },
    'trees/gone.json': { error: 'missing', message: "Referenced tree 'trees/gone.json' not found" },
  };

  it('reports empty, outside, missing, invalid and cyclic references by node id', () => {
    const root = tree({
      type: 'Sequence',
      childNodes: [
        ref('trees/ok.json'),
        { type: 'SubTree' },
        ref('../x.json'),
        ref('trees/gone.json'),
        ref('trees/bad.json'),
        ref('trees/b.json'),
        ref('trees/c.json'),
      ],
    });
    const ids = root.childNodes.map((child) => child.id);
    const problems = checkSubtrees(root, project, library, 'trees/a.json');
    expect(problems.has(ids[0])).toBe(false);
    expect(problems.get(ids[1])?.kind).toBe('empty');
    expect(problems.get(ids[2])?.kind).toBe('outside');
    expect(problems.get(ids[3])).toEqual({
      kind: 'missing',
      message: "Referenced tree 'trees/gone.json' not found",
    });
    expect(problems.get(ids[4])?.kind).toBe('invalid');
    expect(problems.get(ids[5])).toEqual({
      kind: 'cycle',
      message: 'Subtree cycle: trees/a.json → trees/b.json → trees/a.json',
    });
    expect(problems.get(ids[6])?.message).toBe(
      'Subtree cycle: trees/c.json → trees/d.json → trees/c.json',
    );
  });

  it('sees a tree that references itself', () => {
    const root = tree({ type: 'Sequence', childNodes: [ref('trees/a.json')] });
    const problems = checkSubtrees(root, project, {}, 'trees/a.json');
    expect(problems.get(root.childNodes[0].id)?.kind).toBe('cycle');
  });

  it('collects unique references in tree order', () => {
    const root = tree({
      type: 'Sequence',
      childNodes: [ref('trees/b'), ref('trees/a.json'), ref('trees/b.json'), { type: 'Act' }],
    });
    expect(collectSubtreeRefs(root, project)).toEqual(['trees/b.json', 'trees/a.json']);
  });
});

describe('expandSubtrees', () => {
  const library: SubtreeLibrary = {
    'trees/inner.json': {
      tree: { type: 'Sequence', label: 'Inner', childNodes: [{ type: 'Act' }, ref('trees/leaf')] },
    },
    'trees/leaf.json': { tree: { type: 'Act', label: 'Leaf', decorators: [{ type: 'D' }] } },
    'trees/loop.json': { tree: ref('trees/loop.json') },
  };

  it('attaches referenced trees as the only child in child mode, recursively', () => {
    const root = tree({ type: 'Sequence', childNodes: [ref('trees/inner.json')] });
    const {
      root: expanded,
      errors,
      refs,
    } = expandSubtrees(root, project, library, { mode: 'child' });
    expect(errors.size).toBe(0);
    const node = expanded.childNodes[0];
    expect(node.type).toBe('SubTree');
    expect(node.childNodes).toHaveLength(1);
    expect(node.childNodes[0].label).toBe('Inner');
    expect(node.childNodes[0].id).toBe(`${node.id}/1`);
    const leafRef = node.childNodes[0].childNodes[1];
    expect(leafRef.childNodes[0].label).toBe('Leaf');
    expect(refs.get(node.id)).toBe('trees/inner.json');
    expect(refs.get(leafRef.id)).toBe('trees/leaf.json');
    // The input tree is not changed.
    expect(root.childNodes[0].childNodes).toEqual([]);
  });

  it('keeps a tree without subtree nodes as it is', () => {
    const root = tree({ type: 'Sequence', childNodes: [{ type: 'Act' }] });
    expect(expandSubtrees(root, project, library, { mode: 'child' }).root).toBe(root);
  });

  it('replaces the reference node and merges its sub items in inline mode', () => {
    const root = tree({
      type: 'Sequence',
      childNodes: [{ ...ref('trees/leaf.json'), decorators: [{ type: 'Outer' }] }],
    });
    const { root: expanded } = expandSubtrees(root, project, library, { mode: 'inline' });
    const node = expanded.childNodes[0];
    expect(node.type).toBe('Act');
    expect(node.label).toBe('Leaf');
    expect(node.decorators.map((d) => d.type)).toEqual(['Outer', 'D']);
  });

  it('stops at cycles, missing trees and too deep nesting', () => {
    const root = tree({
      type: 'Sequence',
      childNodes: [ref('trees/loop.json'), ref('trees/none.json')],
    });
    const { root: expanded, errors } = expandSubtrees(root, project, library, { mode: 'child' });
    const loopRef = expanded.childNodes[0];
    expect(loopRef.childNodes[0].childNodes).toEqual([]);
    expect(errors.get(loopRef.childNodes[0].id)?.message).toBe(
      'Subtree cycle: trees/loop.json → trees/loop.json',
    );
    expect(errors.get(root.childNodes[1].id)?.kind).toBe('missing');

    const deep: SubtreeLibrary = {};
    for (let i = 0; i < MAX_SUBTREE_DEPTH + 2; i++) {
      deep[`t${i}.json`] = { tree: ref(`t${i + 1}.json`) };
    }
    const result = expandSubtrees(tree(ref('t0.json')), project, deep, { mode: 'child' });
    const kinds: string[] = [];
    for (const problem of result.errors.values()) kinds.push(problem.kind);
    expect(kinds).toEqual(['depth']);
    let count = 0;
    forEachNode(result.root, () => count++);
    expect(count).toBe(MAX_SUBTREE_DEPTH + 1);
  });

  it('is a subtree type check by compiled type', () => {
    expect(getItemType(project, 'node', 'SubTree').subtree).toBe(true);
  });
});
