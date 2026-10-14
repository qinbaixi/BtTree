import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

/** State of the find box over the tree canvas (Ctrl+F). */
export interface SearchState {
  open: boolean;
  query: string;
  /** Index of the current result; -1 before the first jump. */
  index: number;
  /** Increments on every open request so the input is focused again (also when already open). */
  focusSeq: number;
  show(): void;
  close(): void;
  setQuery(query: string): void;
  setIndex(index: number): void;
}

export function createSearchStore() {
  return createStore<SearchState>()((set) => ({
    open: false,
    query: '',
    index: -1,
    focusSeq: 0,
    show() {
      set((state) => ({ open: true, focusSeq: state.focusSeq + 1 }));
    },
    close() {
      set({ open: false, index: -1 });
    },
    setQuery(query) {
      set({ query, index: -1 });
    },
    setIndex(index) {
      set({ index });
    },
  }));
}

export type SearchStore = ReturnType<typeof createSearchStore>;

export const searchStore: SearchStore = createSearchStore();

export function useSearchStore<T>(selector: (state: SearchState) => T): T {
  return useStore(searchStore, selector);
}
