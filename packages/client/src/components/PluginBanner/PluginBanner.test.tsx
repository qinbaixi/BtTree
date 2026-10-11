import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginState } from '../../lib/api';
import { alertStore } from '../../store/alertStore';
import { treeStore } from '../../store/treeStore';
import { TREE_JSON } from '../../test/fixtures';
import PluginBanner, { CHANGED_MESSAGE, DIRTY_CONFIRM, UNTRUSTED_MESSAGE } from './PluginBanner';

const TREE_PATH = '/work/trees/root.json';
const PLUGIN_PATH = '/work/owl-bt.js';

interface Calls {
  method: string;
  url: string;
  body?: unknown;
}

/**
 * Stubs fetch for the endpoints the banner uses. `plugin` is the state the server reports; a trust
 * request switches it to trusted, as the server does.
 */
function stubServer(initial: PluginState | 'error') {
  let plugin: PluginState | 'error' = initial;
  const calls: Calls[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ method, url, body });
    if (url.startsWith('/api/plugin?')) {
      if (plugin === 'error') {
        return new Response('boom', { status: 500 });
      }
      return json(plugin);
    }
    if (url === '/api/plugin/trust' && method === 'POST') {
      plugin = { pluginPath: PLUGIN_PATH, trusted: true, changed: false };
      return json(plugin);
    }
    if (url.startsWith('/api/tree?')) {
      return json(structuredClone(TREE_JSON));
    }
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('PluginBanner', () => {
  beforeEach(() => {
    alertStore.getState().clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows the untrusted warning when the project has a plugin that is not trusted', async () => {
    stubServer({ pluginPath: PLUGIN_PATH, trusted: false, changed: false });
    render(<PluginBanner treePath={TREE_PATH} />);
    expect(await screen.findByText(UNTRUSTED_MESSAGE)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Trust and run' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
  });

  it('uses the changed wording when the trusted plugin was edited since', async () => {
    stubServer({ pluginPath: PLUGIN_PATH, trusted: false, changed: true });
    render(<PluginBanner treePath={TREE_PATH} />);
    expect(await screen.findByText(CHANGED_MESSAGE)).toBeTruthy();
    expect(screen.queryByText(UNTRUSTED_MESSAGE)).toBeNull();
  });

  it('shows nothing when the plugin is trusted or the project has none', async () => {
    stubServer({ pluginPath: PLUGIN_PATH, trusted: true, changed: false });
    const trusted = render(<PluginBanner treePath={TREE_PATH} />);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Trust and run' })).toBeNull());
    expect(trusted.container.textContent).toBe('');
    cleanup();

    stubServer({ pluginPath: null });
    const none = render(<PluginBanner treePath={TREE_PATH} />);
    await waitFor(() => expect(none.container.textContent).toBe(''));
  });

  it('shows nothing when the plugin state cannot be read', async () => {
    stubServer('error');
    const { container } = render(<PluginBanner treePath={TREE_PATH} />);
    await waitFor(() => expect(container.textContent).toBe(''));
  });

  it('hides for this page when dismissed, without trusting anything', async () => {
    const { calls } = stubServer({ pluginPath: PLUGIN_PATH, trusted: false, changed: false });
    render(<PluginBanner treePath={TREE_PATH} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(UNTRUSTED_MESSAGE)).toBeNull();
    expect(calls.some((call) => call.url === '/api/plugin/trust')).toBe(false);
  });

  it('trusts the plugin, reloads the tree and hides the banner on "Trust and run"', async () => {
    const { calls } = stubServer({ pluginPath: PLUGIN_PATH, trusted: false, changed: false });
    render(<PluginBanner treePath={TREE_PATH} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Trust and run' }));

    await waitFor(() => expect(screen.queryByText(UNTRUSTED_MESSAGE)).toBeNull());
    const trustCall = calls.find((call) => call.url === '/api/plugin/trust');
    expect(trustCall).toEqual({
      method: 'POST',
      url: '/api/plugin/trust',
      body: { path: TREE_PATH },
    });
    expect(calls.some((call) => call.url.startsWith(`/api/tree?path=`))).toBe(true);
    expect(treeStore.getState().root?.label).toBe(TREE_JSON.label);
  });

  it('asks before reloading over unsaved edits and does nothing when refused', async () => {
    const { calls } = stubServer({ pluginPath: PLUGIN_PATH, trusted: false, changed: false });
    await treeStore.getState().load(TREE_PATH);
    treeStore.getState().apply('Rename', (draft) => {
      draft.label = 'Edited';
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<PluginBanner treePath={TREE_PATH} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Trust and run' }));

    expect(confirm).toHaveBeenCalledWith(DIRTY_CONFIRM);
    expect(calls.some((call) => call.url === '/api/plugin/trust')).toBe(false);
    expect(treeStore.getState().root?.label).toBe('Edited');
    expect(screen.getByText(UNTRUSTED_MESSAGE)).toBeTruthy();
  });

  it('trusts and reloads over unsaved edits when the user confirms', async () => {
    const { calls } = stubServer({ pluginPath: PLUGIN_PATH, trusted: false, changed: false });
    await treeStore.getState().load(TREE_PATH);
    treeStore.getState().apply('Rename', (draft) => {
      draft.label = 'Edited';
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<PluginBanner treePath={TREE_PATH} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Trust and run' }));

    await waitFor(() => expect(calls.some((call) => call.url === '/api/plugin/trust')).toBe(true));
    await waitFor(() => expect(treeStore.getState().root?.label).toBe(TREE_JSON.label));
    expect(treeStore.getState().dirty).toBe(false);
  });

  it('reports a failed trust as an error alert and keeps the banner', async () => {
    const { fetchMock } = stubServer({ pluginPath: PLUGIN_PATH, trusted: false, changed: false });
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/plugin/trust') {
        return new Response('Save was forbidden', { status: 404 });
      }
      return json({ pluginPath: PLUGIN_PATH, trusted: false, changed: false });
    });

    render(<PluginBanner treePath={TREE_PATH} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Trust and run' }));

    await waitFor(() =>
      expect(alertStore.getState().alerts.map((alert) => alert.type)).toContain('error'),
    );
    expect(screen.getByText(UNTRUSTED_MESSAGE)).toBeTruthy();
  });
});
