import type { ItemKind } from '@owlbt/shared';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { treeStore } from './treeStore';

/** A project type whose definition is shown in the Item Details panel. */
export interface InspectedType {
  kind: ItemKind;
  name: string;
}

export interface InspectState {
  inspected?: InspectedType;
  /** Shows the definition of a project type in the Item Details panel. */
  inspect(kind: ItemKind, name: string): void;
  /** Returns the Item Details panel to the selected item or the tree overview. */
  clear(): void;
}

export const inspectStore = createStore<InspectState>()((set, get) => ({
  inspected: undefined,
  inspect(kind, name) {
    set({ inspected: { kind, name } });
  },
  clear() {
    if (get().inspected !== undefined) {
      set({ inspected: undefined });
    }
  },
}));

export function useInspectStore<T>(selector: (state: InspectState) => T): T {
  return useStore(inspectStore, selector);
}

// Selecting a tree item and loading a tree both end the type inspection.
treeStore.subscribe((state, prev) => {
  const selected = state.selection !== undefined && state.selection !== prev.selection;
  const loaded = (state.loading && !prev.loading) || state.loadCount !== prev.loadCount;
  if (selected || loaded) {
    inspectStore.getState().clear();
  }
});
