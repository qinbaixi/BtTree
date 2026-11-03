import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { fetchPluginExporters, type PluginExporterInfo } from '../lib/api';
import { treeStore } from './treeStore';

export interface ExporterState {
  /** Tree (or project) path the exporters were loaded for. */
  path?: string;
  /** Export formats of the project plugin (owl-bt.js). Empty without a trusted plugin. */
  exporters: PluginExporterInfo[];
  /** Why plugin formats are unavailable (e.g. the plugin is not trusted). */
  error?: string;
  load(path: string): Promise<void>;
}

export interface ExporterStoreDeps {
  fetchExporters: typeof fetchPluginExporters;
}

export function createExporterStore(deps: Partial<ExporterStoreDeps> = {}) {
  const fetchExporters = deps.fetchExporters ?? fetchPluginExporters;
  return createStore<ExporterState>()((set) => {
    let token = 0;
    return {
      exporters: [],
      async load(path) {
        const current = ++token;
        try {
          const result = await fetchExporters(path);
          if (current === token) {
            set({ path, exporters: result.exporters, error: result.error });
          }
        } catch (err) {
          if (current === token) {
            set({ path, exporters: [], error: err instanceof Error ? err.message : String(err) });
          }
        }
      },
    };
  });
}

export type ExporterStore = ReturnType<typeof createExporterStore>;

/** Plugin export formats of the open tree's project. */
export const exporterStore: ExporterStore = createExporterStore();

// Reloaded with every tree load: trusting the plugin reloads the tree, which shows its formats.
treeStore.subscribe((state, previous) => {
  if (
    state.treePath !== undefined &&
    (state.treePath !== previous.treePath || state.loadCount !== previous.loadCount)
  ) {
    void exporterStore.getState().load(state.treePath);
  }
});

export function useExporterStore<T>(selector: (state: ExporterState) => T): T {
  return useStore(exporterStore, selector);
}
