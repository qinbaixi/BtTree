import { createIdGen, nodeFromJson } from '@owlbt/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { DIRTY_TREES_KEY, getDirtyTreePaths, markTreeDirty } from './dirtyTrees';
import {
  formatSelectParam,
  parseSelectParam,
  resolveTreeItemRef,
  treeEditorUrl,
} from './treeLinks';

describe('select URL values', () => {
  it('round-trips nodes and sub items', () => {
    const refs = [
      { nodePath: [], itemKind: 'node' as const },
      { nodePath: [0, 2], itemKind: 'node' as const },
      { nodePath: [1], itemKind: 'decorator' as const, itemIndex: 3 },
      { nodePath: [], itemKind: 'service' as const, itemIndex: 0 },
    ];
    for (const ref of refs) {
      expect(parseSelectParam(formatSelectParam(ref))).toEqual(ref);
    }
    expect(formatSelectParam({ nodePath: [0, 2], itemKind: 'node' })).toBe('node:0.2');
    expect(formatSelectParam({ nodePath: [1], itemKind: 'decorator', itemIndex: 3 })).toBe(
      'decorator:1:3',
    );
  });

  it('rejects malformed values', () => {
    for (const value of ['', 'thing:0', 'node:a', 'node:0:1', 'decorator:0', 'node:-1']) {
      expect(parseSelectParam(value), value).toBeUndefined();
    }
    expect(parseSelectParam(null)).toBeUndefined();
  });

  it('builds tree editor URLs', () => {
    const url = treeEditorUrl('/p/trees/a b.json', { nodePath: [1], itemKind: 'node' });
    const params = new URLSearchParams(url.slice(url.indexOf('?')));
    expect(url.startsWith('/tree?')).toBe(true);
    expect(params.get('path')).toBe('/p/trees/a b.json');
    expect(params.get('select')).toBe('node:1');
    expect(treeEditorUrl('/p/t.json')).toBe('/tree?path=%2Fp%2Ft.json');
  });

  it('resolves references against a loaded tree', () => {
    const root = nodeFromJson(
      {
        type: 'Seq',
        services: [{ type: 'Scan' }],
        childNodes: [{ type: 'A' }, { type: 'B', decorators: [{ type: 'D1' }, { type: 'D2' }] }],
      },
      createIdGen('t'),
    );
    const b = root.childNodes[1];
    expect(resolveTreeItemRef(root, { nodePath: [], itemKind: 'node' })).toEqual({
      kind: 'node',
      nodeId: root.id,
    });
    expect(
      resolveTreeItemRef(root, { nodePath: [1], itemKind: 'decorator', itemIndex: 1 }),
    ).toEqual({ kind: 'decorator', nodeId: b.id, itemId: b.decorators[1].id });
    expect(resolveTreeItemRef(root, { nodePath: [], itemKind: 'service', itemIndex: 0 })).toEqual({
      kind: 'service',
      nodeId: root.id,
      itemId: root.services[0].id,
    });
    expect(resolveTreeItemRef(root, { nodePath: [5], itemKind: 'node' })).toBeUndefined();
    expect(
      resolveTreeItemRef(root, { nodePath: [0], itemKind: 'decorator', itemIndex: 0 }),
    ).toBeUndefined();
  });
});

describe('dirty trees', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('records and clears the trees with unsaved edits', () => {
    markTreeDirty('/p/a.json', true, 1000);
    markTreeDirty('/p/b.json', true, 1000);
    expect(getDirtyTreePaths(2000)).toEqual(['/p/a.json', '/p/b.json']);
    markTreeDirty('/p/a.json', false, 2000);
    expect(getDirtyTreePaths(2000)).toEqual(['/p/b.json']);
  });

  it('ignores old and malformed entries', () => {
    window.localStorage.setItem(
      DIRTY_TREES_KEY,
      JSON.stringify([{ path: '/p/old.json', tab: 'x', at: 0 }, { path: 3 }, 'junk']),
    );
    expect(getDirtyTreePaths(13 * 60 * 60 * 1000)).toEqual([]);
    window.localStorage.setItem(DIRTY_TREES_KEY, '{bad');
    expect(getDirtyTreePaths()).toEqual([]);
  });
});
