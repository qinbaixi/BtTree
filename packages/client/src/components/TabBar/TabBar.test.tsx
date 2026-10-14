import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createIdGen } from '@owlbt/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TREE_JSON } from '../../test/fixtures';
import { createTabsStore } from '../../store/tabsStore';
import { createTreeStore } from '../../store/treeStore';
import TabBar from './TabBar';

const A = '/p/trees/a.json';
const B = '/p/trees/b.json';

async function setup() {
  const tree = createTreeStore({
    fetchTree: vi.fn(async () => structuredClone(TREE_JSON)),
    saveTree: vi.fn(async () => undefined),
    idGen: createIdGen('t'),
  });
  const saveTree = vi.fn(async () => undefined);
  const store = createTabsStore({
    tree,
    saveTree,
    beforeSwitch: vi.fn(),
    getViewTransform: () => undefined,
    requestViewTransform: vi.fn(),
    loadPersisted: () => ({ paths: [] }),
    persist: vi.fn(),
    notify: { error: vi.fn(), success: vi.fn() },
  });
  await act(async () => {
    store.getState().open(A);
    await new Promise((resolve) => setTimeout(resolve, 0));
    store.getState().open(B);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const onOpenTree = vi.fn();
  render(<TabBar store={store} onOpenTree={onOpenTree} />);
  const tab = (name: string) => screen.getByRole('tab', { name: new RegExp(`^${name}`) });
  return { store, tree, onOpenTree, tab };
}

describe('TabBar', () => {
  afterEach(cleanup);

  it('shows one tab per tree with the file name and the full path as tooltip', async () => {
    const { tab } = await setup();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(tab('a.json').getAttribute('title')).toBe(A);
    expect(tab('b.json').getAttribute('aria-selected')).toBe('true');
    expect(tab('a.json').getAttribute('aria-selected')).toBe('false');
  });

  it('activates a tab on click and marks dirty tabs with *', async () => {
    const { tab, tree } = await setup();
    act(() => {
      tree.getState().apply('Edit', (draft) => {
        draft.label = 'changed';
      });
    });
    expect(tab('b.json').textContent).toContain('b.json*');
    fireEvent.click(tab('a.json'));
    expect(tab('a.json').getAttribute('aria-selected')).toBe('true');
    expect(tab('b.json').textContent).toContain('*');
    expect(tab('a.json').textContent).not.toContain('*');
  });

  it('closes a tab with its close button and with a middle click', async () => {
    const { store } = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Close a.json' }));
    await act(async () => undefined);
    expect(store.getState().tabs.map((item) => item.path)).toEqual([B]);

    fireEvent(
      screen.getByRole('tab', { name: /^b\.json/ }),
      new MouseEvent('auxclick', { bubbles: true, button: 1 }),
    );
    await act(async () => undefined);
    expect(store.getState().tabs).toEqual([]);
  });

  it('asks Save / Discard / Cancel before closing a dirty tab', async () => {
    const { store, tree } = await setup();
    act(() => {
      tree.getState().apply('Edit', (draft) => {
        draft.label = 'changed';
      });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Close b.json' }));
    expect(screen.getByRole('alertdialog').textContent).toContain(
      'Save changes to b.json before closing?',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await act(async () => undefined);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(store.getState().tabs).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Close b.json' }));
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    await act(async () => undefined);
    expect(store.getState().tabs).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Close b.json' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await act(async () => undefined);
    expect(store.getState().tabs.map((item) => item.path)).toEqual([A]);
  });

  it('offers Open tree…', async () => {
    const { onOpenTree } = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Open tree…' }));
    expect(onOpenTree).toHaveBeenCalledTimes(1);
  });
});
