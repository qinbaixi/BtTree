import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MRU_STORAGE_KEY } from '../lib/mru';
import Home, { LAST_DIR_STORAGE_KEY } from './Home';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route
          path="/tree"
          element={
            <>
              <div>Editor page</div>
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

/** The top bar buttons come first in the DOM, before the buttons of the empty state. */
function topBarButton(name: string): HTMLElement {
  return screen.getAllByRole('button', { name })[0];
}

type Responder = (url: URL, body: unknown) => Response | Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function text(message: string, status: number): Response {
  return new Response(message, { status, headers: { 'content-type': 'text/plain' } });
}

/** Fake API keyed by "METHOD /path". Unknown requests fail the test. */
function mockApi(routes: Record<string, Responder>) {
  const calls: Array<{ method: string; url: URL; body: unknown }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ method, url, body });
    const responder = routes[`${method} ${url.pathname}`];
    if (!responder) {
      throw new Error(`Unexpected request ${method} ${url.pathname}`);
    }
    return responder(url, body);
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

const WORKSPACE = {
  dir: '/work/trees',
  projectPath: '/work/owl-bt.json',
  projectDir: '/work',
  trees: [
    { path: '/work/trees/a.json', relPath: 'trees/a.json' },
    { path: '/work/trees/sub/b.json', relPath: 'trees/sub/b.json' },
  ],
  truncated: false,
};

describe('Home', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('navigates to the editor for a .json path typed in the box', () => {
    renderHome();
    fireEvent.change(screen.getByPlaceholderText('Tree file or folder path…'), {
      target: { value: 'D:\\trees\\owl.json' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    expect(screen.getByText('Editor page')).toBeTruthy();
    expect(screen.getByTestId('location').textContent).toBe('/tree?path=D%3A%5Ctrees%5Cowl.json');
  });

  it('loads the workspace for a folder path typed in the box', async () => {
    const calls = mockApi({ 'GET /api/workspace': () => json(WORKSPACE) });
    renderHome();

    fireEvent.change(screen.getByPlaceholderText('Tree file or folder path…'), {
      target: { value: '/work/trees' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    expect(await screen.findByText('trees/a.json')).toBeTruthy();
    expect(calls[0].url.searchParams.get('dir')).toBe('/work/trees');
    expect(screen.queryByText('Editor page')).toBeNull();
    expect(window.localStorage.getItem(LAST_DIR_STORAGE_KEY)).toBe('/work/trees');
  });

  it('does not navigate or request anything for an empty path', () => {
    const calls = mockApi({});
    renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    expect(screen.queryByText('Editor page')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('lists recently used trees and opens one by clicking it', () => {
    window.localStorage.setItem(
      MRU_STORAGE_KEY,
      JSON.stringify([{ path: '/a/first.json' }, { path: '/b/second.json' }]),
    );
    renderHome();

    expect(screen.getByText('first.json')).toBeTruthy();
    expect(screen.getByText('/b/second.json')).toBeTruthy();

    fireEvent.click(screen.getByText('second.json'));
    expect(screen.getByTestId('location').textContent).toBe('/tree?path=%2Fb%2Fsecond.json');
  });

  it('removes an item from the list and from storage', () => {
    window.localStorage.setItem(
      MRU_STORAGE_KEY,
      JSON.stringify([{ path: '/a/first.json' }, { path: '/b/second.json' }]),
    );
    renderHome();

    fireEvent.click(screen.getByRole('button', { name: 'Remove /a/first.json from the list' }));

    expect(screen.queryByText('first.json')).toBeNull();
    expect(window.localStorage.getItem(MRU_STORAGE_KEY)).toBe('[{"path":"/b/second.json"}]');
  });

  it('shows the empty state with both big buttons when there is nothing to show', () => {
    renderHome();
    expect(screen.getByText('Open a behavior tree')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Open folder…' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Open tree file…' })).toHaveLength(2);
  });

  describe('Open folder', () => {
    it('opens the dialog, then lists the trees of the chosen folder', async () => {
      const calls = mockApi({
        'POST /api/dialog/pick': () => json({ path: '/work/trees' }),
        'GET /api/workspace': () => json(WORKSPACE),
      });
      renderHome();

      fireEvent.click(topBarButton('Open folder…'));

      expect(await screen.findByRole('region', { name: 'Workspace' })).toBeTruthy();
      expect(screen.getByText('/work/owl-bt.json')).toBeTruthy();
      expect(screen.getByRole('link', { name: /trees\/sub\/b\.json/ })).toBeTruthy();
      expect(calls[0].body).toEqual({ kind: 'folder' });
    });

    it('sends the remembered folder as the starting folder', async () => {
      window.localStorage.setItem(LAST_DIR_STORAGE_KEY, '/work/trees');
      const calls = mockApi({
        'GET /api/workspace': () => json(WORKSPACE),
        'POST /api/dialog/pick': () => json({ cancelled: true }),
      });
      renderHome();
      await screen.findByText('trees/a.json');

      fireEvent.click(topBarButton('Open folder…'));

      await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
        kind: 'folder',
        initialDir: '/work/trees',
      });
    });

    it('shows a waiting message and disables the buttons while the dialog is open', async () => {
      let answer: (response: Response) => void = () => {};
      mockApi({
        'POST /api/dialog/pick': () =>
          new Promise<Response>((resolve) => {
            answer = resolve;
          }),
      });
      renderHome();

      fireEvent.click(topBarButton('Open folder…'));

      expect(await screen.findByText('Waiting for the file dialog…')).toBeTruthy();
      expect((topBarButton('Open tree file…') as HTMLButtonElement).disabled).toBe(true);

      answer(json({ cancelled: true }));
      await waitFor(() => expect(screen.queryByText('Waiting for the file dialog…')).toBeNull());
      expect((topBarButton('Open tree file…') as HTMLButtonElement).disabled).toBe(false);
    });

    it('shows an inline message telling the user to type the path when no dialog exists', async () => {
      mockApi({
        'POST /api/dialog/pick': () =>
          json({ message: 'No native file dialog is available on this system.' }, 501),
      });
      renderHome();

      fireEvent.click(topBarButton('Open folder…'));

      expect(
        await screen.findByText(
          'No native file dialog is available on this system. Type the path in the box above instead.',
        ),
      ).toBeTruthy();
    });

    it('shows an inline message when the folder cannot be read', async () => {
      mockApi({
        'POST /api/dialog/pick': () => json({ path: '/gone' }),
        'GET /api/workspace': () => text('Path not found', 404),
      });
      renderHome();

      fireEvent.click(topBarButton('Open folder…'));

      expect((await screen.findByRole('alert')).textContent).toBe('Path not found');
      expect(screen.getByRole('button', { name: 'Close folder' })).toBeTruthy();
    });
  });

  describe('Open tree file', () => {
    it('navigates to the editor with the chosen file', async () => {
      const calls = mockApi({
        'POST /api/dialog/pick': () => json({ path: '/work/trees/a.json' }),
      });
      renderHome();

      fireEvent.click(topBarButton('Open tree file…'));

      expect(await screen.findByText('Editor page')).toBeTruthy();
      expect(screen.getByTestId('location').textContent).toBe(
        '/tree?path=%2Fwork%2Ftrees%2Fa.json',
      );
      expect(calls[0].body).toEqual({ kind: 'file' });
    });

    it('stays put when the dialog is cancelled', async () => {
      mockApi({ 'POST /api/dialog/pick': () => json({ cancelled: true }) });
      renderHome();

      fireEvent.click(topBarButton('Open tree file…'));

      await waitFor(() => expect(screen.queryByText('Waiting for the file dialog…')).toBeNull());
      expect(screen.queryByText('Editor page')).toBeNull();
    });
  });

  describe('workspace panel', () => {
    it('restores the last folder on load', async () => {
      window.localStorage.setItem(LAST_DIR_STORAGE_KEY, '/work/trees');
      const calls = mockApi({ 'GET /api/workspace': () => json(WORKSPACE) });
      renderHome();

      expect(await screen.findByText('trees/a.json')).toBeTruthy();
      expect(calls[0].url.searchParams.get('dir')).toBe('/work/trees');
    });

    it('closing the folder forgets it', async () => {
      window.localStorage.setItem(LAST_DIR_STORAGE_KEY, '/work/trees');
      mockApi({ 'GET /api/workspace': () => json(WORKSPACE) });
      renderHome();
      await screen.findByText('trees/a.json');

      fireEvent.click(screen.getByRole('button', { name: 'Close folder' }));

      expect(screen.queryByRole('region', { name: 'Workspace' })).toBeNull();
      expect(window.localStorage.getItem(LAST_DIR_STORAGE_KEY)).toBeNull();
    });

    it('shows an empty state when the folder has no trees', async () => {
      mockApi({
        'GET /api/workspace': () => json({ ...WORKSPACE, trees: [] }),
      });
      window.localStorage.setItem(LAST_DIR_STORAGE_KEY, '/work/trees');
      renderHome();

      expect(await screen.findByText('No tree files found in this folder.')).toBeTruthy();
    });

    it('initializes a project in a folder outside any project', async () => {
      window.localStorage.setItem(LAST_DIR_STORAGE_KEY, '/loose');
      const calls = mockApi({
        'GET /api/workspace': () => json({ dir: '/loose', trees: [], truncated: false }),
        'POST /api/project/init': () =>
          json({
            dir: '/loose',
            projectPath: '/loose/owl-bt.json',
            projectDir: '/loose',
            trees: [{ path: '/loose/trees/example.json', relPath: 'trees/example.json' }],
            truncated: false,
          }),
      });
      renderHome();

      fireEvent.click(await screen.findByRole('button', { name: 'Initialize project here' }));

      expect(await screen.findByText('trees/example.json')).toBeTruthy();
      expect(screen.queryByText('This folder is not inside an owl-bt project.')).toBeNull();
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ dir: '/loose' });
    });

    it('shows the server error when initializing fails', async () => {
      window.localStorage.setItem(LAST_DIR_STORAGE_KEY, '/loose');
      mockApi({
        'GET /api/workspace': () => json({ dir: '/loose', trees: [], truncated: false }),
        'POST /api/project/init': () => text('Directory is already inside a project', 409),
      });
      renderHome();

      fireEvent.click(await screen.findByRole('button', { name: 'Initialize project here' }));

      expect(await screen.findByText('Directory is already inside a project')).toBeTruthy();
    });

    it('creates a new tree relative to the folder and opens it', async () => {
      window.localStorage.setItem(LAST_DIR_STORAGE_KEY, '/work/trees');
      const calls = mockApi({
        'GET /api/workspace': () => json(WORKSPACE),
        'POST /api/tree/create': () => json({ path: '/work/trees/my-tree.json' }),
      });
      renderHome();
      await screen.findByText('trees/a.json');

      fireEvent.change(screen.getByPlaceholderText('trees/my-tree.json'), {
        target: { value: 'my-tree' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Create' }));

      expect(await screen.findByText('Editor page')).toBeTruthy();
      expect(screen.getByTestId('location').textContent).toBe(
        '/tree?path=%2Fwork%2Ftrees%2Fmy-tree.json',
      );
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
        path: '/work/trees/my-tree',
      });
    });

    it('shows the server error for a new tree inline', async () => {
      window.localStorage.setItem(LAST_DIR_STORAGE_KEY, '/work/trees');
      mockApi({
        'GET /api/workspace': () => json(WORKSPACE),
        'POST /api/tree/create': () => text('File already exists', 409),
      });
      renderHome();
      await screen.findByText('trees/a.json');

      fireEvent.change(screen.getByPlaceholderText('trees/my-tree.json'), {
        target: { value: 'a.json' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Create' }));

      expect(await screen.findByText('File already exists')).toBeTruthy();
      expect(screen.queryByText('Editor page')).toBeNull();
    });

    it('refreshes the listing', async () => {
      window.localStorage.setItem(LAST_DIR_STORAGE_KEY, '/work/trees');
      let listing = WORKSPACE;
      const calls = mockApi({ 'GET /api/workspace': () => json(listing) });
      renderHome();
      await screen.findByText('trees/a.json');

      listing = {
        ...WORKSPACE,
        trees: [{ path: '/work/trees/new.json', relPath: 'trees/new.json' }],
      };
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

      expect(await screen.findByText('trees/new.json')).toBeTruthy();
      expect(calls.filter((c) => c.method === 'GET')).toHaveLength(2);
    });
  });
});
