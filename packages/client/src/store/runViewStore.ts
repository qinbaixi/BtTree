import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { getJson, setJson } from '../lib/storage';

export const SHOW_IDS_STORAGE_KEY = 'owlbt.runShowIds';

interface RunViewState {
  /** Show the export node ids (#N) in the run log and on the canvas cards. */
  showIds: boolean;
  setShowIds(value: boolean): void;
}

export const runViewStore = createStore<RunViewState>((set) => ({
  showIds: getJson<boolean>(SHOW_IDS_STORAGE_KEY, true) !== false,
  setShowIds(value) {
    setJson(SHOW_IDS_STORAGE_KEY, value);
    set({ showIds: value });
  },
}));

export function useRunViewStore<T>(selector: (state: RunViewState) => T): T {
  return useStore(runViewStore, selector);
}
