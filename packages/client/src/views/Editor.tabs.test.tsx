import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROJECT_JSON, TREE_JSON } from '../test/fixtures';
import { tabsStore, TABS_STORAGE_KEY } from '../store/tabsStore';
import { treeStore } from '../store/treeStore';
import Editor from './Editor';

vi.mock('socket.io-client', () => ({
  io: () => ({ on: () => undefined, disconnect: () => undefined }),
}));

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return {
    ...actual,
    fetchProject: vi.fn(async () => PROJECT_JSON),
    fetchTree: vi.fn(async (path: string) => ({ ...structuredClone(TREE_JSON), label: path })),
    saveTree: vi.fn(async () => undefined),
    fetchPluginState: vi.fn(async () => ({ pluginPath: null })),
  };
});

const A = '/p/a.json';
const B = '/p/b.json';

function Location() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/tree" element={<Editor />} />
        <Route path="/" element={<div>home page</div>} />
      </Routes>
      <Location />
    </MemoryRouter>,
  );
}

const urlOf = (path: string) => `/tree?${new URLSearchParams({ path }).toString()}`;

describe('Editor tabs', () => {
  afterEach(cleanup);

  it('opens trees in tabs, keeps the URL on the active one and closes back to the home page', async () => {
    window.localStorage.clear();
    renderAt(urlOf(A));
    await screen.findByRole('tab', { name: /^a\.json/ });
    await waitFor(() => expect(treeStore.getState().root?.label).toBe(A));

    act(() => tabsStore.getState().open(B));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(urlOf(B)));
    await waitFor(() => expect(treeStore.getState().root?.label).toBe(B));
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(JSON.parse(window.localStorage.getItem(TABS_STORAGE_KEY) ?? '{}')).toEqual({
      paths: [A, B],
      active: B,
    });

    // An edit in B marks the tab and the window title.
    act(() => {
      treeStore.getState().apply('Edit', (draft) => {
        draft.label = 'changed';
      });
    });
    expect(document.title).toBe('*b.json - owl-bt');

    // Ctrl+PageUp goes to the previous tab; B keeps its change.
    fireEvent.keyDown(window, { key: 'PageUp', ctrlKey: true });
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(urlOf(A)));
    expect(treeStore.getState().root?.label).toBe(A);
    expect(document.title).toBe('*a.json - owl-bt');

    // Ctrl+W closes A (clean); B comes back with its change.
    fireEvent.keyDown(window, { key: 'w', ctrlKey: true });
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(urlOf(B)));
    expect(treeStore.getState().root?.label).toBe('changed');

    // Closing the dirty last tab asks first; Discard closes it and returns home.
    fireEvent.click(screen.getByRole('button', { name: 'Close b.json' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    await screen.findByText('home page');
    expect(tabsStore.getState().tabs).toEqual([]);
  });
});
