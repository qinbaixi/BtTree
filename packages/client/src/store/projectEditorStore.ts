import { applyPatches, enablePatches, produceWithPatches, type Patch } from 'immer';
import {
  collapseRenames,
  compileProject,
  findType,
  type RefRename,
  type ItemKind,
  type ProjectFile,
  type ProjectReloadPayload,
} from '@owlbt/shared';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import {
  ApiError,
  fetchProjectMeta,
  saveProject,
  type ProjectMeta,
  type ProjectSaveBody,
} from '../lib/api';
import { t } from '../i18n';
import { alerts } from './alertStore';
import {
  defaultSocketFactory,
  PROJECT_RELOAD_EVENT,
  type ProjectSocket,
  type SocketFactory,
} from './projectStore';
import { UNDO_STACK_LIMIT } from './treeStore';

enablePatches();

/** What the center and preview panels show. */
export type ProjectSelection =
  | { view: 'type'; kind: ItemKind; name: string }
  | { view: 'custom'; name?: string }
  | { view: 'export' }
  | { view: 'scenarios' }
  | { view: 'blackboard'; name?: string };

export interface ProjectHistoryEntry {
  label: string;
  patches: Patch[];
  inversePatches: Patch[];
  /** Consecutive edits with the same key on the same item form one undo step (typing in a field). */
  coalesceKey?: string;
  selectionBefore?: ProjectSelection;
  selectionAfter?: ProjectSelection;
  /** Types / blackboard keys renamed by the step (tree files can be updated after saving). */
  renames?: RefRename[];
}

export interface ApplyOptions {
  coalesceKey?: string;
  /** Renames done by the step, recorded so that tree files can be updated after the next save. */
  renames?: RefRename[];
}

export interface ProjectEditorDeps {
  fetchMeta: (path: string) => Promise<ProjectMeta>;
  save: (path: string, body: ProjectSaveBody) => Promise<{ hash: string }>;
  createSocket: SocketFactory;
}

export interface ProjectEditorState {
  projectPath?: string;
  /** Hash of the file text the draft was loaded from (or last written as). */
  baseHash?: string;
  draft?: ProjectFile;
  loading: boolean;
  loadError?: string;
  dirty: boolean;
  /** Increments on every change of the draft (edits, undo, redo, reload). */
  version: number;
  undoStack: ProjectHistoryEntry[];
  redoStack: ProjectHistoryEntry[];
  selection?: ProjectSelection;
  saving: boolean;
  /** Last save error (blocked by compile errors, or a failed request). */
  saveError?: string;
  /** A save was rejected because the file changed on disk. The conflict dialog is open. */
  conflict: boolean;
  /** The file changed on disk while there are unsaved edits. */
  externalChange: boolean;
  /** The file on disk could not be read as a project (live reload). */
  externalError?: string;
  /**
   * Net renames of types and blackboard keys in the saves since the last clearSavedRenames: tree
   * files may still use the old names.
   */
  savedRenames: RefRename[];

  load(path: string): Promise<void>;
  /**
   * Applies a recipe to the draft as one undoable step. Returns false when nothing changed.
   * `nextSelection`: undefined keeps the selection, null clears it.
   */
  apply(
    label: string,
    recipe: (draft: ProjectFile) => void,
    nextSelection?: ProjectSelection | null,
    options?: ApplyOptions,
  ): boolean;
  undo(): void;
  redo(): void;
  select(selection?: ProjectSelection): void;
  /** Saves the draft. Returns true on success. A stale file opens the conflict dialog instead. */
  save(): Promise<boolean>;
  /** Saves even though the file changed on disk. */
  overwrite(): Promise<boolean>;
  /** Replaces the draft with the file on disk (unsaved edits are discarded). */
  reload(): Promise<void>;
  dismissConflict(): void;
  /** Hides the "changed on disk" banner and keeps the edits. */
  keepMine(): void;
  /** Forgets the saved renames (tree files were updated, or the user declined). */
  clearSavedRenames(): void;
  /** Handles a `prj-reload` payload of the socket. */
  receive(payload: ProjectReloadPayload): void;
  connect(path: string): void;
  disconnect(): void;
}

export type ProjectEditorStore = ReturnType<typeof createProjectEditorStore>;

/** Message of the server when the file changed since the editor loaded it (HTTP 409). */
export const CONFLICT_MESSAGE = 'Project file changed on disk';

const defaultDeps: ProjectEditorDeps = {
  fetchMeta: fetchProjectMeta,
  save: saveProject,
  createSocket: defaultSocketFactory,
};

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Canonical JSON text of a value: used to recognise the echo of our own saves. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * JSON text with object keys sorted. Undo can restore a key at another position than it had, which
 * is not a change of the file, so dirty checks compare this form.
 */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (typeof inner === 'object' && inner !== null && !Array.isArray(inner)) {
      const entries = Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return Object.fromEntries(entries);
    }
    return inner;
  });
}

/** Parses project text. Returns the canonical JSON, or the error. */
export function parseProjectText(text: string): { json?: string; error?: string } {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { error: t('Project file must contain a JSON object') };
    }
    return { json: canonicalJson(parsed) };
  } catch (err) {
    return { error: errorText(err) };
  }
}

/** Keeps the selection when its type still exists in the draft; otherwise clears it. */
export function keepSelection(
  draft: ProjectFile,
  selection: ProjectSelection | undefined,
): ProjectSelection | undefined {
  if (!selection) {
    return undefined;
  }
  if (selection.view === 'type') {
    return findType(draft, selection.kind, selection.name) ? selection : undefined;
  }
  return selection;
}

export function createProjectEditorStore(overrides: Partial<ProjectEditorDeps> = {}) {
  const deps: ProjectEditorDeps = { ...defaultDeps, ...overrides };

  return createStore<ProjectEditorState>()((set, get) => {
    let socket: ProjectSocket | undefined;
    let loadToken = 0;
    /** Canonical JSON of the text last loaded or written. Our own file-watcher echo matches it. */
    let savedJson: string | undefined;
    /** stableJson of the draft last loaded or written. Dirty checks compare drafts with it. */
    let savedKey: string | undefined;
    /** Canonical JSON of the text the last save attempted to write. */
    let attemptedJson: string | undefined;
    /** Renames since the last load or save, in order (undo adds the reverse rename). */
    let renameLog: RefRename[] = [];
    const logRenames = (renames: RefRename[] | undefined, reverse = false): void => {
      for (const rename of renames ?? []) {
        renameLog.push(reverse ? { ...rename, from: rename.to, to: rename.from } : rename);
      }
    };

    /** True when the draft has the content of the last load or save (undo back to it is clean). */
    const isSaved = (draft: ProjectFile | undefined): boolean =>
      draft !== undefined && savedKey !== undefined && stableJson(draft) === savedKey;

    /** Replaces the draft with the file on disk. Answers for superseded loads are ignored. */
    const adopt = async (path: string, token: number): Promise<void> => {
      let meta: ProjectMeta;
      try {
        meta = await deps.fetchMeta(path);
      } catch (err) {
        if (token === loadToken) {
          set({ loading: false, loadError: errorText(err) });
        }
        return;
      }
      if (token !== loadToken) {
        return;
      }
      const parsed = parseProjectText(meta.content);
      if (parsed.json === undefined) {
        set({ loading: false, loadError: parsed.error ?? t('Invalid project file') });
        return;
      }
      const draft = JSON.parse(parsed.json) as ProjectFile;
      savedJson = parsed.json;
      savedKey = stableJson(draft);
      renameLog = [];
      set((state) => ({
        projectPath: meta.path,
        baseHash: meta.hash,
        draft,
        loading: false,
        loadError: undefined,
        dirty: false,
        conflict: false,
        externalChange: false,
        externalError: undefined,
        saveError: undefined,
        undoStack: [],
        redoStack: [],
        selection: keepSelection(draft, state.selection),
        version: state.version + 1,
      }));
    };

    /** Shared by save and overwrite. `force` skips the stale-file check on the server. */
    const write = async (force: boolean): Promise<boolean> => {
      const { projectPath, draft, baseHash } = get();
      if (!projectPath || !draft || baseHash === undefined) {
        alerts.error(t('Unable to save before the project is loaded'));
        return false;
      }
      try {
        compileProject(draft);
      } catch (err) {
        const message = errorText(err);
        set({ saveError: message });
        alerts.error(t('Not saved: {message}', { message }));
        return false;
      }

      const snapshot = draft;
      const loggedRenames = renameLog.length;
      attemptedJson = canonicalJson(snapshot);
      const attemptedKey = stableJson(snapshot);
      set({ saving: true, saveError: undefined });
      try {
        const { hash } = await deps.save(projectPath, { content: snapshot, baseHash, force });
        savedJson = attemptedJson;
        savedKey = attemptedKey;
        const saved = renameLog.slice(0, loggedRenames);
        renameLog = renameLog.slice(loggedRenames);
        // Edits made while the request was running stay unsaved.
        set((state) => ({
          baseHash: hash,
          saving: false,
          conflict: false,
          externalChange: false,
          dirty: !isSaved(get().draft),
          savedRenames:
            saved.length > 0
              ? collapseRenames([...state.savedRenames, ...saved])
              : state.savedRenames,
        }));
        alerts.success(t('Project saved'));
        return true;
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          set({ saving: false, conflict: true });
          return false;
        }
        const message = errorText(err);
        set({ saving: false, saveError: message });
        alerts.error(message);
        return false;
      }
    };

    return {
      dirty: false,
      version: 0,
      loading: false,
      undoStack: [],
      redoStack: [],
      saving: false,
      conflict: false,
      externalChange: false,
      savedRenames: [],

      async load(path) {
        const token = ++loadToken;
        savedJson = undefined;
        savedKey = undefined;
        set({
          loading: true,
          loadError: undefined,
          projectPath: undefined,
          draft: undefined,
          savedRenames: [],
        });
        await adopt(path, token);
      },

      apply(label, recipe, nextSelection, options) {
        const state = get();
        const { draft } = state;
        if (!draft) {
          return false;
        }
        const [nextDraft, patches, inversePatches] = produceWithPatches(draft, recipe);
        if (patches.length === 0) {
          return false;
        }
        const selectionAfter =
          nextSelection === undefined ? state.selection : (nextSelection ?? undefined);
        const last = state.undoStack[state.undoStack.length - 1];
        // Merge into the previous step only while the selection stays on the same item.
        const merge =
          options?.coalesceKey !== undefined &&
          last !== undefined &&
          last.coalesceKey === options.coalesceKey &&
          canonicalJson(last.selectionAfter) === canonicalJson(state.selection) &&
          canonicalJson(selectionAfter) === canonicalJson(last.selectionAfter);

        let undoStack: ProjectHistoryEntry[];
        if (merge && last) {
          const merged: ProjectHistoryEntry = {
            ...last,
            patches: [...last.patches, ...patches],
            inversePatches: [...inversePatches, ...last.inversePatches],
            selectionAfter,
          };
          if (options?.renames) {
            merged.renames = [...(last.renames ?? []), ...options.renames];
          }
          undoStack = [...state.undoStack.slice(0, -1), merged];
        } else {
          const entry: ProjectHistoryEntry = {
            label,
            patches,
            inversePatches,
            coalesceKey: options?.coalesceKey,
            selectionBefore: state.selection,
            selectionAfter,
          };
          if (options?.renames && options.renames.length > 0) {
            entry.renames = options.renames;
          }
          undoStack = [...state.undoStack, entry].slice(-UNDO_STACK_LIMIT);
        }
        logRenames(options?.renames);
        set({
          draft: nextDraft,
          selection: selectionAfter,
          dirty: !isSaved(nextDraft),
          version: state.version + 1,
          undoStack,
          redoStack: [],
        });
        return true;
      },

      undo() {
        const state = get();
        const entry = state.undoStack[state.undoStack.length - 1];
        if (!entry || !state.draft) {
          return;
        }
        const nextDraft = applyPatches(state.draft, entry.inversePatches);
        logRenames(entry.renames && [...entry.renames].reverse(), true);
        set({
          draft: nextDraft,
          selection: entry.selectionBefore,
          dirty: !isSaved(nextDraft),
          version: state.version + 1,
          undoStack: state.undoStack.slice(0, -1),
          redoStack: [...state.redoStack, entry],
        });
      },

      redo() {
        const state = get();
        const entry = state.redoStack[state.redoStack.length - 1];
        if (!entry || !state.draft) {
          return;
        }
        const nextDraft = applyPatches(state.draft, entry.patches);
        logRenames(entry.renames);
        set({
          draft: nextDraft,
          selection: entry.selectionAfter,
          dirty: !isSaved(nextDraft),
          version: state.version + 1,
          undoStack: [...state.undoStack, entry].slice(-UNDO_STACK_LIMIT),
          redoStack: state.redoStack.slice(0, -1),
        });
      },

      select(selection) {
        set({ selection });
      },

      save() {
        return write(false);
      },

      overwrite() {
        return write(true);
      },

      async reload() {
        const { projectPath } = get();
        if (!projectPath) {
          return;
        }
        const token = ++loadToken;
        await adopt(projectPath, token);
      },

      dismissConflict() {
        set({ conflict: false });
      },

      keepMine() {
        set({ externalChange: false });
      },

      clearSavedRenames() {
        set({ savedRenames: [] });
      },

      receive(payload) {
        if ('error' in payload) {
          set({ externalError: payload.error });
          return;
        }
        const parsed = parseProjectText(payload.content);
        if (parsed.json === undefined) {
          set({ externalError: parsed.error ?? t('Invalid project file') });
          return;
        }
        set({ externalError: undefined });
        const { draft, dirty } = get();
        const current = draft ? canonicalJson(draft) : undefined;
        if (parsed.json === savedJson || parsed.json === attemptedJson || parsed.json === current) {
          return;
        }
        if (dirty) {
          set({ externalChange: true });
          return;
        }
        void get().reload();
      },

      connect(path) {
        get().disconnect();
        const current = deps.createSocket(path);
        socket = current;
        current.on(PROJECT_RELOAD_EVENT, (payload) => {
          if (socket !== current) {
            return; // stale socket after disconnect/reconnect
          }
          get().receive(payload);
        });
      },

      disconnect() {
        socket?.disconnect();
        socket = undefined;
      },
    };
  });
}

/** Application-wide store of the project editor page. */
export const projectEditorStore: ProjectEditorStore = createProjectEditorStore();

export function useProjectEditorStore<T>(selector: (state: ProjectEditorState) => T): T {
  return useStore(projectEditorStore, selector);
}
