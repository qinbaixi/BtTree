import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { projectStore as appProjectStore, type ProjectStore } from './projectStore';

/** One entry of a list select dialog. `id` is returned to the caller on accept. */
export interface FuzzyItem {
  id: string;
  /** Text shown and matched by the fuzzy filter. */
  name: string;
  icon?: string;
  color?: string;
  /** Right-aligned text, e.g. a hotkey. */
  hint?: string;
}

export interface DialogRequest {
  /** Unique per opened dialog; used as a React key so each dialog starts fresh. */
  id: number;
  items: FuzzyItem[];
  onAccept(id: string): void;
}

export interface DialogState {
  /** The open modal dialog, if any. */
  current?: DialogRequest;
  open(items: FuzzyItem[], onAccept: (id: string) => void): void;
  close(): void;
  /** Closes the dialog first, then reports the accepted item id. */
  accept(id: string): void;
}

export type DialogStore = ReturnType<typeof createDialogStore>;

let nextDialogId = 1;

/**
 * Creates a dialog store. The open dialog is closed whenever the project store reloads
 * (project hot reload invalidates the items the dialog was built from).
 */
export function createDialogStore(project: ProjectStore = appProjectStore) {
  const store = createStore<DialogState>()((set, get) => ({
    current: undefined,

    open(items, onAccept) {
      set({ current: { id: nextDialogId++, items, onAccept } });
    },

    close() {
      set({ current: undefined });
    },

    accept(id) {
      const request = get().current;
      if (!request) {
        return;
      }
      set({ current: undefined });
      request.onAccept(id);
    },
  }));

  project.subscribe((state, prev) => {
    if (state.version !== prev.version && store.getState().current) {
      store.getState().close();
    }
  });

  return store;
}

/** Application-wide dialog store. */
export const dialogStore: DialogStore = createDialogStore();

export function useDialogStore<T>(selector: (state: DialogState) => T): T {
  return useStore(dialogStore, selector);
}
