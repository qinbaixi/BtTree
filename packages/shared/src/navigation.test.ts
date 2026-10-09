import { describe, expect, it } from 'vitest';
import { navigate } from './navigation';
import type { Selection, SubItem, TreeNode } from './types';

function sub(id: string, type: string): SubItem {
  return { id, type, properties: {}, extra: {} };
}

function node(
  id: string,
  opts: { decorators?: SubItem[]; services?: SubItem[]; childNodes?: TreeNode[] } = {},
): TreeNode {
  return {
    id,
    type: 'T',
    properties: {},
    decorators: opts.decorators ?? [],
    services: opts.services ?? [],
    childNodes: opts.childNodes ?? [],
    extra: {},
  };
}

/**
 * root (3 children: a, b, c)
 *  a: decorators d1,d2 ; services s1,s2 ; children a1, a2
 *    a2: decorators x1
 */
function buildTree(): TreeNode {
  return node('root', {
    childNodes: [
      node('a', {
        decorators: [sub('d1', 'decorator'), sub('d2', 'decorator')],
        services: [sub('s1', 'service'), sub('s2', 'service')],
        childNodes: [node('a1'), node('a2', { decorators: [sub('x1', 'decorator')] })],
      }),
      node('b'),
      node('c'),
    ],
  });
}

const header = (nodeId: string): Selection => ({ kind: 'node', nodeId });
const dec = (nodeId: string, itemId: string): Selection => ({ kind: 'decorator', nodeId, itemId });
const svc = (nodeId: string, itemId: string): Selection => ({ kind: 'service', nodeId, itemId });

describe('navigate without selection', () => {
  it('selects the root for every direction', () => {
    const root = buildTree();
    for (const dir of ['up', 'down', 'left', 'right'] as const) {
      expect(navigate(root, undefined, dir)).toEqual(header('root'));
    }
  });
});

describe('navigate down', () => {
  const root = buildTree();

  it('goes from a node header to its first decorator, then first service', () => {
    expect(navigate(root, header('a'), 'down')).toEqual(dec('a', 'd1'));
    const noDecorators = node('r', { services: [sub('v1', 'service')] });
    expect(navigate(noDecorators, header('r'), 'down')).toEqual(svc('r', 'v1'));
  });

  it('moves through decorators, then to the first service', () => {
    expect(navigate(root, dec('a', 'd1'), 'down')).toEqual(dec('a', 'd2'));
    expect(navigate(root, dec('a', 'd2'), 'down')).toEqual(svc('a', 's1'));
  });

  it('moves through services, then to the middle child', () => {
    expect(navigate(root, svc('a', 's1'), 'down')).toEqual(svc('a', 's2'));
    // a has 2 children -> floor((2-1)/2) = 0 -> a1
    expect(navigate(root, svc('a', 's2'), 'down')).toEqual(header('a1'));
  });

  it('selects the middle child (floor((n-1)/2)) from a header with children', () => {
    // root has 3 children -> index 1 -> b
    expect(navigate(root, header('root'), 'down')).toEqual(header('b'));
  });

  it('skips decorators when going down from a decorator to a service', () => {
    const r = node('r', { decorators: [sub('d', 'decorator')], services: [sub('s', 'service')] });
    expect(navigate(r, dec('r', 'd'), 'down')).toEqual(svc('r', 's'));
  });

  it('goes to the middle child from the last decorator when there are no services', () => {
    const r = node('r', {
      decorators: [sub('d', 'decorator')],
      childNodes: [node('k1'), node('k2'), node('k3'), node('k4')],
    });
    // 4 children -> floor(3/2) = 1 -> k2
    expect(navigate(r, dec('r', 'd'), 'down')).toEqual(header('k2'));
  });

  it('returns the same selection when there is nothing below', () => {
    const sel = header('a1');
    expect(navigate(root, sel, 'down')).toBe(sel);
    const lastDec = dec('a2', 'x1');
    expect(navigate(root, lastDec, 'down')).toBe(lastDec);
    const c = header('c');
    expect(navigate(root, c, 'down')).toBe(c);
  });

  it('returns the same selection for unknown nodes or items', () => {
    const sel = header('ghost');
    expect(navigate(root, sel, 'down')).toBe(sel);
    const unknownItem = dec('a', 'nope');
    expect(navigate(root, unknownItem, 'down')).toBe(unknownItem);
  });
});

describe('navigate up', () => {
  const root = buildTree();

  it('goes from a decorator to the previous decorator, then to the node header', () => {
    expect(navigate(root, dec('a', 'd2'), 'up')).toEqual(dec('a', 'd1'));
    expect(navigate(root, dec('a', 'd1'), 'up')).toEqual(header('a'));
  });

  it('goes from a service to the previous service', () => {
    expect(navigate(root, svc('a', 's2'), 'up')).toEqual(svc('a', 's1'));
  });

  it('goes from the first service to the last decorator when decorators exist', () => {
    expect(navigate(root, svc('a', 's1'), 'up')).toEqual(dec('a', 'd2'));
  });

  it('goes from the first service to the node header when there are no decorators', () => {
    const r = node('r', { services: [sub('v1', 'service'), sub('v2', 'service')] });
    expect(navigate(r, svc('r', 'v1'), 'up')).toEqual(header('r'));
  });

  it('goes from a node header to the last service of the parent', () => {
    expect(navigate(root, header('a1'), 'up')).toEqual(svc('a', 's2'));
    expect(navigate(root, header('b'), 'up')).toEqual(header('root'));
  });

  it('goes from a node header to the last decorator of the parent when it has no services', () => {
    const r = node('r', {
      childNodes: [
        node('p', {
          decorators: [sub('d1', 'decorator'), sub('d2', 'decorator')],
          childNodes: [node('k')],
        }),
      ],
    });
    expect(navigate(r, header('k'), 'up')).toEqual(dec('p', 'd2'));
  });

  it('goes from a node header to the parent header when the parent has no sub items', () => {
    const r = node('r', { childNodes: [node('p', { childNodes: [node('k')] })] });
    expect(navigate(r, header('k'), 'up')).toEqual(header('p'));
  });

  it('goes from the first decorator of a nested node to its node header', () => {
    expect(navigate(root, dec('a2', 'x1'), 'up')).toEqual(header('a2'));
  });

  it('returns the same selection at the root and for unknown items', () => {
    const rootSel = header('root');
    expect(navigate(root, rootSel, 'up')).toBe(rootSel);
    const unknown = svc('a', 'nope');
    expect(navigate(root, unknown, 'up')).toBe(unknown);
  });
});

describe('navigate left / right', () => {
  const root = buildTree();

  it('moves a node header to the left and right sibling', () => {
    expect(navigate(root, header('b'), 'left')).toEqual(header('a'));
    expect(navigate(root, header('b'), 'right')).toEqual(header('c'));
  });

  it('returns the same selection at the first or last sibling', () => {
    const first = header('a');
    expect(navigate(root, first, 'left')).toBe(first);
    const last = header('c');
    expect(navigate(root, last, 'right')).toBe(last);
  });

  it('uses the owning node for sub item selections', () => {
    // d1 belongs to a; siblings of a are none on the left, b on the right
    expect(navigate(root, dec('a', 'd1'), 'left')).toEqual(dec('a', 'd1'));
    expect(navigate(root, dec('a', 'd1'), 'right')).toEqual(header('b'));
    expect(navigate(root, svc('a', 's2'), 'right')).toEqual(header('b'));
  });

  it('moves between children of nested nodes', () => {
    expect(navigate(root, header('a1'), 'right')).toEqual(header('a2'));
    expect(navigate(root, dec('a2', 'x1'), 'left')).toEqual(header('a1'));
  });

  it('returns the same selection for the root node', () => {
    const rootSel = header('root');
    expect(navigate(root, rootSel, 'left')).toBe(rootSel);
    expect(navigate(root, rootSel, 'right')).toBe(rootSel);
  });
});

describe('navigate full walk', () => {
  it('walks down through every item in visual order and back up', () => {
    const root = buildTree();
    const order: Selection[] = [
      header('a'),
      dec('a', 'd1'),
      dec('a', 'd2'),
      svc('a', 's1'),
      svc('a', 's2'),
      header('a1'),
    ];
    let sel: Selection = header('a');
    for (let i = 1; i < order.length; i++) {
      sel = navigate(root, sel, 'down');
      expect(sel).toEqual(order[i]);
    }
    for (let i = order.length - 2; i >= 0; i--) {
      sel = navigate(root, sel, 'up');
      expect(sel).toEqual(order[i]);
    }
  });
});
