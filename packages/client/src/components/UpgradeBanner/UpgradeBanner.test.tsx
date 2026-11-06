import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MissingBuiltin } from '../../lib/api';
import { alertStore } from '../../store/alertStore';
import UpgradeBanner from './UpgradeBanner';

const TREE_PATH = '/work/trees/root.json';
const PROJECT_PATH = '/work/owl-bt.json';
const MISSING: MissingBuiltin[] = [
  { kind: 'node', name: 'UtilitySelector', since: '0.3.2' },
  { kind: 'decorator', name: 'Utility', since: '0.3.2' },
];

interface Call {
  method: string;
  url: string;
  body?: unknown;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Stubs the upgrade endpoints; an upgrade empties the missing list, as the server does. */
function stubServer(initial: MissingBuiltin[], options: { conflict?: boolean } = {}) {
  let missing = initial;
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
      calls.push({ method, url, body });
      if (url.startsWith('/api/project/upgrade?')) {
        if (method === 'GET') {
          return json({ projectPath: PROJECT_PATH, hash: 'h1', missing });
        }
        if (options.conflict) {
          return json({ message: 'Project file changed on disk', currentHash: 'h2' }, 409);
        }
        const added = missing;
        missing = [];
        return json({ projectPath: PROJECT_PATH, hash: 'h2', added, addedCustomTypes: [] });
      }
      if (url.startsWith('/api/project?')) {
        return new Response('{"nodes":[],"decorators":[],"services":[]}', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }),
  );
  return calls;
}

describe('UpgradeBanner', () => {
  beforeEach(() => {
    alertStore.getState().clear();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('lists the missing built-in types', async () => {
    stubServer(MISSING);
    render(<UpgradeBanner treePath={TREE_PATH} />);
    expect(await screen.findByText(/UtilitySelector, Utility/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add to owl-bt.json' })).toBeTruthy();
  });

  it('shows nothing when the project is up to date or the check fails', async () => {
    stubServer([]);
    const upToDate = render(<UpgradeBanner treePath={TREE_PATH} />);
    await waitFor(() => expect(upToDate.container.textContent).toBe(''));
    cleanup();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 })),
    );
    const failed = render(<UpgradeBanner treePath={TREE_PATH} />);
    await waitFor(() => expect(failed.container.textContent).toBe(''));
  });

  it('adds the types with the hash it read and hides the banner', async () => {
    const calls = stubServer(MISSING);
    render(<UpgradeBanner treePath={TREE_PATH} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add to owl-bt.json' }));

    await waitFor(() => expect(screen.queryByTestId('upgrade-banner')).toBeNull());
    expect(calls.find((call) => call.method === 'POST')).toEqual({
      method: 'POST',
      url: `/api/project/upgrade?path=${encodeURIComponent(TREE_PATH)}`,
      body: { baseHash: 'h1' },
    });
    expect(alertStore.getState().alerts.some((alert) => alert.type === 'success')).toBe(true);
  });

  it('reports a conflict and keeps the banner', async () => {
    stubServer(MISSING, { conflict: true });
    render(<UpgradeBanner treePath={TREE_PATH} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add to owl-bt.json' }));

    await waitFor(() =>
      expect(alertStore.getState().alerts.some((alert) => alert.type === 'error')).toBe(true),
    );
    expect(screen.getByTestId('upgrade-banner')).toBeTruthy();
  });

  it('remembers a dismissal for the same missing types', async () => {
    stubServer(MISSING);
    const first = render(<UpgradeBanner treePath={TREE_PATH} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(first.container.textContent).toBe('');
    cleanup();

    const again = render(<UpgradeBanner treePath={TREE_PATH} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(again.container.textContent).toBe('');
  });
});
