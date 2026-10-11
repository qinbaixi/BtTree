import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, fetchTree, fetchPluginState, trustPlugin } from './api';

function stubFetch(response: Response) {
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('api errors', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the JSON message of a 422 response for a tree that is not valid JSON', async () => {
    stubFetch(
      new Response(JSON.stringify({ message: 'Invalid JSON in tree file: Unexpected token' }), {
        status: 422,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const error = await fetchTree('/work/tree.json').catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 422,
      message: 'Invalid JSON in tree file: Unexpected token',
    });
  });

  it('keeps the text of a plain error response', async () => {
    stubFetch(new Response('Path not found', { status: 404 }));
    await expect(fetchTree('/work/tree.json')).rejects.toMatchObject({
      status: 404,
      message: 'Path not found',
    });
  });
});

describe('plugin API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks for the plugin state of the project of a tree', async () => {
    const fetchMock = stubFetch(
      new Response(
        JSON.stringify({ pluginPath: '/work/owl-bt.js', trusted: false, changed: true }),
        {
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    await expect(fetchPluginState('/work/trees/a b.json')).resolves.toEqual({
      pluginPath: '/work/owl-bt.js',
      trusted: false,
      changed: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/plugin?path=%2Fwork%2Ftrees%2Fa+b.json',
      undefined,
    );
  });

  it('posts the tree path to trust the plugin', async () => {
    const fetchMock = stubFetch(
      new Response(
        JSON.stringify({ pluginPath: '/work/owl-bt.js', trusted: true, changed: false }),
        {
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    await trustPlugin('/work/trees/a.json');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/plugin/trust');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ path: '/work/trees/a.json' });
  });
});
