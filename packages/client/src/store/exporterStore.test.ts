import { describe, expect, it, vi } from 'vitest';
import { createExporterStore } from './exporterStore';

const XML = { format: 'xml', label: 'XML', extension: '.xml', outDir: 'export/xml' };

describe('exporterStore', () => {
  it('loads the plugin formats of a path', async () => {
    const fetchExporters = vi.fn(async () => ({ exporters: [XML], warnings: [] }));
    const store = createExporterStore({ fetchExporters });
    await store.getState().load('/p/trees/a.json');
    expect(fetchExporters).toHaveBeenCalledWith('/p/trees/a.json');
    expect(store.getState()).toMatchObject({ path: '/p/trees/a.json', exporters: [XML] });
    expect(store.getState().error).toBeUndefined();
  });

  it('keeps no formats and the reason when they are unavailable', async () => {
    const store = createExporterStore({
      fetchExporters: async () => ({ exporters: [], warnings: [], error: 'not trusted' }),
    });
    await store.getState().load('/p/a.json');
    expect(store.getState()).toMatchObject({ exporters: [], error: 'not trusted' });

    const failing = createExporterStore({
      fetchExporters: async () => {
        throw new Error('offline');
      },
    });
    failing.setState({ exporters: [XML] });
    await failing.getState().load('/p/a.json');
    expect(failing.getState()).toMatchObject({ exporters: [], error: 'offline' });
  });

  it('ignores an older answer that arrives after a newer one', async () => {
    let resolveFirst: (value: { exporters: (typeof XML)[]; warnings: string[] }) => void = () => {};
    const fetchExporters = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce({ exporters: [], warnings: [] });
    const store = createExporterStore({ fetchExporters });
    const first = store.getState().load('/a.json');
    await store.getState().load('/b.json');
    resolveFirst({ exporters: [XML], warnings: [] });
    await first;
    expect(store.getState()).toMatchObject({ path: '/b.json', exporters: [] });
  });
});
