import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renameType } from '@owlbt/shared';
import { ApiError, type ProjectMeta } from '../lib/api';
import { alertStore } from './alertStore';
import {
  createProjectEditorStore,
  keepSelection,
  parseProjectText,
  stableJson,
} from './projectEditorStore';
import { PROJECT_RELOAD_EVENT, type ProjectSocket } from './projectStore';

const PATH = '/work/owl-bt.json';

const PROJECT = {
  nodes: [
    { name: 'Selector', isComposite: true, icon: 'question' },
    { name: 'Wait', properties: [{ name: 'duration', type: 'number', default: 1 }] },
  ],
  services: [{ name: 'Logger' }],
  futureField: { keep: true },
};

function meta(content: unknown, hash = 'hash-1'): ProjectMeta {
  return { path: PATH, hash, content: JSON.stringify(content, null, 4) };
}

/** Store wired to fake deps: the tests control what the file says and what saves answer. */
function setup(content: unknown = PROJECT) {
  const fetchMeta = vi.fn(async () => meta(content));
  const save = vi.fn(async () => ({ hash: 'hash-2' }));
  const listeners: Array<(payload: unknown) => void> = [];
  const socket: ProjectSocket & { disconnect: ReturnType<typeof vi.fn> } = {
    on: vi.fn((_event: string, listener: (payload: unknown) => void) => {
      listeners.push(listener);
    }),
    disconnect: vi.fn(),
  } as never;
  const createSocket = vi.fn(() => socket);
  const store = createProjectEditorStore({
    fetchMeta,
    save,
    createSocket,
  });
  return {
    store,
    fetchMeta,
    save,
    socket,
    createSocket,
    /** Delivers a payload as if the socket had sent it. */
    emit: (payload: unknown) => store.getState().receive(payload as never),
    /** Calls the listeners registered through connect(). */
    emitSocket: (payload: unknown) => listeners.forEach((listener) => listener(payload)),
  };
}

describe('projectEditorStore', () => {
  beforeEach(() => {
    alertStore.getState().clear();
  });

  describe('load', () => {
    it('loads the draft, the path and the hash', async () => {
      const { store } = setup();
      await store.getState().load(PATH);
      const state = store.getState();
      expect(state.projectPath).toBe(PATH);
      expect(state.baseHash).toBe('hash-1');
      expect(state.draft).toEqual(PROJECT);
      expect(state.dirty).toBe(false);
      expect(state.loading).toBe(false);
    });

    it('reports a file that is not a JSON object', async () => {
      const { store, fetchMeta } = setup();
      fetchMeta.mockResolvedValueOnce({ path: PATH, hash: 'x', content: '[1,2]' });
      await store.getState().load(PATH);
      expect(store.getState().draft).toBeUndefined();
      expect(store.getState().loadError).toBe('Project file must contain a JSON object');
    });

    it('reports a failed request', async () => {
      const { store, fetchMeta } = setup();
      fetchMeta.mockRejectedValueOnce(new Error('No project found'));
      await store.getState().load(PATH);
      expect(store.getState().loadError).toBe('No project found');
    });
  });

  describe('apply, undo and redo', () => {
    it('applies a recipe as one undoable step and marks the draft dirty', async () => {
      const { store } = setup();
      await store.getState().load(PATH);
      const changed = store.getState().apply('Rename', (draft) => {
        draft.nodes![0].name = 'Choose';
      });
      expect(changed).toBe(true);
      expect(store.getState().draft?.nodes?.[0].name).toBe('Choose');
      expect(store.getState().dirty).toBe(true);
      expect(store.getState().undoStack).toHaveLength(1);

      store.getState().undo();
      expect(store.getState().draft?.nodes?.[0].name).toBe('Selector');
      expect(store.getState().redoStack).toHaveLength(1);

      store.getState().redo();
      expect(store.getState().draft?.nodes?.[0].name).toBe('Choose');
    });

    it('does nothing for recipes that change nothing', async () => {
      const { store } = setup();
      await store.getState().load(PATH);
      expect(store.getState().apply('noop', () => undefined)).toBe(false);
      expect(store.getState().undoStack).toHaveLength(0);
      expect(store.getState().dirty).toBe(false);
    });

    it('merges consecutive edits with the same coalesce key into one undo step', async () => {
      const { store } = setup();
      await store.getState().load(PATH);
      const key = { coalesceKey: 'icon:node:Selector' };
      for (const icon of ['q', 'qu', 'que']) {
        store.getState().apply(
          'Set icon',
          (draft) => {
            draft.nodes![0].icon = icon;
          },
          undefined,
          key,
        );
      }
      expect(store.getState().undoStack).toHaveLength(1);
      expect(store.getState().draft?.nodes?.[0].icon).toBe('que');

      store.getState().undo();
      expect(store.getState().draft?.nodes?.[0].icon).toBe('question');
    });

    it('does not merge when the selection moved in between', async () => {
      const { store } = setup();
      await store.getState().load(PATH);
      const key = { coalesceKey: 'k' };
      store.getState().apply(
        'a',
        (d) => {
          d.nodes![0].icon = 'a';
        },
        { view: 'type', kind: 'node', name: 'Selector' },
        key,
      );
      store.getState().apply(
        'b',
        (d) => {
          d.nodes![0].icon = 'b';
        },
        { view: 'type', kind: 'node', name: 'Wait' },
        key,
      );
      expect(store.getState().undoStack).toHaveLength(2);
    });

    it('sets the selection, and null clears it', async () => {
      const { store } = setup();
      await store.getState().load(PATH);
      store.getState().apply(
        'Select',
        (d) => {
          d.services![0].icon = 'x';
        },
        { view: 'type', kind: 'service', name: 'Logger' },
      );
      expect(store.getState().selection).toEqual({ view: 'type', kind: 'service', name: 'Logger' });

      store.getState().apply(
        'Delete',
        (d) => {
          d.services = [];
        },
        null,
      );
      expect(store.getState().selection).toBeUndefined();
    });

    it('keeps the history bounded', async () => {
      const { store } = setup();
      await store.getState().load(PATH);
      for (let i = 0; i < 105; i++) {
        store.getState().apply('edit', (d) => {
          d.nodes![1].description = `v${i}`;
        });
      }
      expect(store.getState().undoStack).toHaveLength(100);
    });
  });

  describe('save', () => {
    it('writes the draft with the loaded hash and clears dirty', async () => {
      const { store, save } = setup();
      await store.getState().load(PATH);
      store.getState().apply('Rename', (d) => {
        d.nodes![0].name = 'Choose';
      });
      expect(await store.getState().save()).toBe(true);
      expect(save).toHaveBeenCalledWith(PATH, {
        content: expect.objectContaining({ futureField: { keep: true } }),
        baseHash: 'hash-1',
        force: false,
      });
      expect(store.getState().baseHash).toBe('hash-2');
      expect(store.getState().dirty).toBe(false);
    });

    it('refuses to save content that does not compile', async () => {
      const { store, save } = setup();
      await store.getState().load(PATH);
      store.getState().apply('Break', (d) => {
        d.nodes![1].base = 'Missing';
      });
      expect(await store.getState().save()).toBe(false);
      expect(save).not.toHaveBeenCalled();
      expect(store.getState().saveError).toBe("Missing base type 'Missing' for 'Wait'");
      expect(store.getState().dirty).toBe(true);
    });

    it('opens the conflict dialog on 409 and keeps the edits', async () => {
      const { store, save } = setup();
      await store.getState().load(PATH);
      store.getState().apply('Rename', (d) => {
        d.nodes![0].name = 'Choose';
      });
      save.mockRejectedValueOnce(new ApiError(409, 'Project file changed on disk'));
      expect(await store.getState().save()).toBe(false);
      expect(store.getState().conflict).toBe(true);
      expect(store.getState().draft?.nodes?.[0].name).toBe('Choose');
      expect(store.getState().dirty).toBe(true);

      store.getState().dismissConflict();
      expect(store.getState().conflict).toBe(false);
    });

    it('overwrites with force after a conflict', async () => {
      const { store, save } = setup();
      await store.getState().load(PATH);
      store.getState().apply('Rename', (d) => {
        d.nodes![0].name = 'Choose';
      });
      save.mockRejectedValueOnce(new ApiError(409, 'Project file changed on disk'));
      await store.getState().save();

      expect(await store.getState().overwrite()).toBe(true);
      expect(save).toHaveBeenLastCalledWith(PATH, expect.objectContaining({ force: true }));
      expect(store.getState().conflict).toBe(false);
      expect(store.getState().dirty).toBe(false);
    });

    it('keeps the draft dirty when edits were made while the request ran', async () => {
      const { store, save } = setup();
      await store.getState().load(PATH);
      store.getState().apply('First', (d) => {
        d.nodes![0].name = 'A';
      });
      save.mockImplementationOnce(async () => {
        store.getState().apply('Second', (d) => {
          d.nodes![0].name = 'B';
        });
        return { hash: 'hash-2' };
      });
      await store.getState().save();
      expect(store.getState().dirty).toBe(true);
      expect(store.getState().draft?.nodes?.[0].name).toBe('B');
    });

    it('reports other failures as save errors', async () => {
      const { store, save } = setup();
      await store.getState().load(PATH);
      store.getState().apply('Rename', (d) => {
        d.nodes![0].name = 'Choose';
      });
      save.mockRejectedValueOnce(new ApiError(500, 'disk full'));
      expect(await store.getState().save()).toBe(false);
      expect(store.getState().saveError).toBe('disk full');
      expect(store.getState().conflict).toBe(false);
    });
  });

  describe('reload', () => {
    it('replaces the draft, clears history and keeps a selection that still exists', async () => {
      const { store, fetchMeta } = setup();
      await store.getState().load(PATH);
      store.getState().apply(
        'Select',
        (d) => {
          d.nodes![0].icon = 'x';
        },
        { view: 'type', kind: 'node', name: 'Selector' },
      );

      fetchMeta.mockResolvedValueOnce(
        meta({ ...PROJECT, nodes: [{ name: 'Selector' }] }, 'hash-9'),
      );
      await store.getState().reload();

      expect(store.getState().draft?.nodes).toEqual([{ name: 'Selector' }]);
      expect(store.getState().baseHash).toBe('hash-9');
      expect(store.getState().undoStack).toHaveLength(0);
      expect(store.getState().selection).toEqual({ view: 'type', kind: 'node', name: 'Selector' });
    });
  });

  describe('live reload (receive)', () => {
    it('ignores the echo of its own save', async () => {
      const { store, fetchMeta, emit } = setup();
      await store.getState().load(PATH);
      store.getState().apply('Rename', (d) => {
        d.nodes![0].name = 'Choose';
      });
      await store.getState().save();
      const callsBefore = fetchMeta.mock.calls.length;
      emit({ content: JSON.stringify(store.getState().draft) });
      expect(fetchMeta.mock.calls.length).toBe(callsBefore);
      expect(store.getState().externalChange).toBe(false);
    });

    it('reloads silently when the file changes and there are no unsaved edits', async () => {
      const { store, fetchMeta, emit } = setup();
      await store.getState().load(PATH);
      fetchMeta.mockResolvedValueOnce(meta({ ...PROJECT, services: [] }, 'hash-7'));
      emit({ content: JSON.stringify({ ...PROJECT, services: [] }) });
      await vi.waitFor(() => expect(store.getState().baseHash).toBe('hash-7'));
      expect(store.getState().draft?.services).toEqual([]);
      expect(store.getState().externalChange).toBe(false);
    });

    it('shows the banner instead of replacing the draft when there are unsaved edits', async () => {
      const { store, fetchMeta, emit } = setup();
      await store.getState().load(PATH);
      store.getState().apply('Rename', (d) => {
        d.nodes![0].name = 'Choose';
      });
      emit({ content: JSON.stringify({ ...PROJECT, services: [] }) });
      expect(store.getState().externalChange).toBe(true);
      expect(store.getState().draft?.nodes?.[0].name).toBe('Choose');
      expect(fetchMeta).toHaveBeenCalledTimes(1);

      store.getState().keepMine();
      expect(store.getState().externalChange).toBe(false);
    });

    it('reports unreadable files and error payloads', async () => {
      const { store, emit } = setup();
      await store.getState().load(PATH);
      emit({ content: '{"nodes":' });
      expect(store.getState().externalError).toBeTruthy();
      emit({ error: 'No project found' });
      expect(store.getState().externalError).toBe('No project found');
      emit({ content: JSON.stringify(PROJECT) });
      expect(store.getState().externalError).toBeUndefined();
    });
  });

  describe('connect and disconnect', () => {
    it('subscribes once per connect and disconnects the previous socket', async () => {
      const { store, createSocket, socket, emitSocket } = setup();
      await store.getState().load(PATH);
      store.getState().connect(PATH);
      expect(createSocket).toHaveBeenCalledWith(PATH);
      expect(socket.on).toHaveBeenCalledWith(PROJECT_RELOAD_EVENT, expect.any(Function));
      emitSocket({ error: 'from socket' });
      expect(store.getState().externalError).toBe('from socket');
      store.getState().disconnect();
      expect(socket.disconnect).toHaveBeenCalled();
      emitSocket({ error: 'late' });
      expect(store.getState().externalError).toBe('from socket');
    });
  });
});

describe('helpers', () => {
  it('parseProjectText returns canonical JSON or an error', () => {
    expect(parseProjectText('{ "a" : 1 }')).toEqual({ json: '{"a":1}' });
    expect(parseProjectText('"x"').error).toBe('Project file must contain a JSON object');
    expect(parseProjectText('{').error).toBeTruthy();
  });

  it('keepSelection drops a type selection whose type is gone', () => {
    expect(keepSelection(PROJECT, { view: 'type', kind: 'node', name: 'Wait' })).toBeDefined();
    expect(keepSelection(PROJECT, { view: 'type', kind: 'node', name: 'Gone' })).toBeUndefined();
    expect(keepSelection(PROJECT, { view: 'export' })).toEqual({ view: 'export' });
    expect(keepSelection(PROJECT, undefined)).toBeUndefined();
  });
});

describe('dirty state against the saved text', () => {
  beforeEach(() => {
    alertStore.getState().clear();
  });

  it('undo back to the loaded state is clean, and redo makes it dirty again', async () => {
    const { store } = setup();
    await store.getState().load(PATH);
    store.getState().apply('Rename', (draft) => {
      draft.nodes![0].name = 'Choose';
    });
    expect(store.getState().dirty).toBe(true);

    store.getState().undo();
    expect(store.getState().dirty).toBe(false);

    store.getState().redo();
    expect(store.getState().dirty).toBe(true);
  });

  it('after a save, undo leaves the saved state and is dirty; redo returns to clean', async () => {
    const { store } = setup();
    await store.getState().load(PATH);
    store.getState().apply('Rename', (draft) => {
      draft.nodes![0].name = 'Choose';
    });
    await store.getState().save();
    expect(store.getState().dirty).toBe(false);

    store.getState().undo();
    expect(store.getState().draft?.nodes?.[0].name).toBe('Selector');
    expect(store.getState().dirty).toBe(true);

    store.getState().redo();
    expect(store.getState().dirty).toBe(false);
  });

  it('an edit made after undoing past the save stays dirty', async () => {
    const { store } = setup();
    await store.getState().load(PATH);
    store.getState().apply('Rename', (draft) => {
      draft.nodes![0].name = 'Choose';
    });
    await store.getState().save();
    store.getState().undo();
    store.getState().apply('Other', (draft) => {
      draft.nodes![0].name = 'Other';
    });
    expect(store.getState().dirty).toBe(true);
    store.getState().undo();
    expect(store.getState().dirty).toBe(true);
  });

  it('ignores key order: an undo that restores a key elsewhere is still clean', async () => {
    const { store } = setup();
    await store.getState().load(PATH);
    store.getState().apply('Remove icon', (draft) => {
      delete draft.nodes![0].icon;
    });
    expect(store.getState().dirty).toBe(true);
    store.getState().undo();
    expect(store.getState().dirty).toBe(false);
  });

  it('undo back to the text that was saved is clean, even when edits were made during the save', async () => {
    const { store, save } = setup();
    await store.getState().load(PATH);
    store.getState().apply('Rename', (draft) => {
      draft.nodes![0].name = 'Choose';
    });
    let release: (() => void) | undefined;
    save.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ hash: 'hash-2' });
        }),
    );
    const pending = store.getState().save();
    store.getState().apply('Second', (draft) => {
      draft.nodes![0].name = 'Second';
    });
    release?.();
    await pending;
    expect(store.getState().dirty).toBe(true);
    store.getState().undo();
    // The save wrote the Choose state, so undoing the second edit lands on the saved text.
    expect(store.getState().draft?.nodes?.[0].name).toBe('Choose');
    expect(store.getState().dirty).toBe(false);
  });
});

describe('stableJson', () => {
  it('sorts object keys at every level and keeps array order', () => {
    expect(stableJson({ b: 1, a: { d: 2, c: [{ z: 1, y: 2 }] } })).toBe(
      '{"a":{"c":[{"y":2,"z":1}],"d":2},"b":1}',
    );
  });
});

describe('projectEditorStore renames', () => {
  const rename = (store: ReturnType<typeof setup>['store'], from: string, to: string) =>
    store.getState().apply(
      'Rename type',
      (draft) => {
        renameType(draft, 'node', from, to);
      },
      undefined,
      { renames: [{ kind: 'node', from, to }] },
    );

  it('records the net renames of a save', async () => {
    const { store } = setup();
    await store.getState().load(PATH);
    rename(store, 'Wait', 'Pause');
    rename(store, 'Pause', 'Sleep');
    expect(store.getState().savedRenames).toEqual([]);
    await store.getState().save();
    expect(store.getState().savedRenames).toEqual([{ kind: 'node', from: 'Wait', to: 'Sleep' }]);

    // A later save adds to them until they are cleared.
    rename(store, 'Selector', 'Choose');
    await store.getState().save();
    expect(store.getState().savedRenames).toEqual([
      { kind: 'node', from: 'Wait', to: 'Sleep' },
      { kind: 'node', from: 'Selector', to: 'Choose' },
    ]);
    store.getState().clearSavedRenames();
    expect(store.getState().savedRenames).toEqual([]);
  });

  it('forgets renames that were undone, and records the undo of a saved rename', async () => {
    const { store } = setup();
    await store.getState().load(PATH);
    rename(store, 'Wait', 'Pause');
    store.getState().undo();
    await store.getState().save();
    expect(store.getState().savedRenames).toEqual([]);

    rename(store, 'Wait', 'Pause');
    await store.getState().save();
    store.getState().clearSavedRenames();
    store.getState().undo();
    await store.getState().save();
    expect(store.getState().savedRenames).toEqual([{ kind: 'node', from: 'Pause', to: 'Wait' }]);

    store.getState().redo();
    await store.getState().reload();
    expect(store.getState().draft?.nodes?.[1].name).toBe('Wait');
  });
});
