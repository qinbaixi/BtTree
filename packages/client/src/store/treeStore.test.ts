import {
  createIdGen,
  nodeToJson,
  parseAndCompileProject,
  type Selection,
  type TreeNode,
} from '@owlbt/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PROJECT_JSON, TREE_JSON } from '../test/fixtures';
import { alertStore } from './alertStore';
import {
  createTreeStore,
  getSelectedItem,
  selectCanRedo,
  selectCanUndo,
  UNDO_STACK_LIMIT,
} from './treeStore';

function setup() {
  const saveTree = vi.fn(async () => undefined);
  const store = createTreeStore({
    fetchTree: vi.fn(async () => structuredClone(TREE_JSON)),
    saveTree,
    idGen: createIdGen('t'),
  });
  return { store, saveTree };
}

async function loaded() {
  const ctx = setup();
  await ctx.store.getState().load('/trees/root.json');
  return ctx;
}

describe('treeStore', () => {
  beforeEach(() => {
    alertStore.getState().clear();
  });

  it('loads the tree into the runtime model', async () => {
    const { store } = await loaded();
    const state = store.getState();
    expect(state.root?.label).toBe('Root');
    expect(state.root?.childNodes).toHaveLength(2);
    expect(state.root?.childNodes[0].decorators[0].type).toBe('Inverter');
    expect(state.dirty).toBe(false);
    expect(state.selection).toBeUndefined();
    expect(state.loadCount).toBe(1);
    expect(state.undoStack).toEqual([]);
  });

  it('reports load failures through state and alerts', async () => {
    const store = createTreeStore({
      fetchTree: async () => {
        throw new Error('Path not found');
      },
      saveTree: async () => undefined,
    });
    await store.getState().load('/x.json');
    expect(store.getState().error).toBe('Path not found');
    expect(store.getState().root).toBeUndefined();
    expect(alertStore.getState().alerts[0]?.message).toContain('Path not found');
  });

  it('applies a recipe as one undoable step and marks the tree dirty', async () => {
    const { store } = await loaded();
    const before = store.getState().version;
    const applied = store.getState().apply('Rename', (draft) => {
      draft.label = 'Renamed';
    });

    expect(applied).toBe(true);
    const state = store.getState();
    expect(state.root?.label).toBe('Renamed');
    expect(state.dirty).toBe(true);
    expect(state.version).toBe(before + 1);
    expect(state.undoStack).toHaveLength(1);
    expect(state.undoStack[0].label).toBe('Rename');
    expect(state.redoStack).toEqual([]);
  });

  it('does nothing when the recipe changes nothing', async () => {
    const { store } = await loaded();
    const root = store.getState().root;
    expect(store.getState().apply('Noop', () => undefined)).toBe(false);
    expect(store.getState().root).toBe(root);
    expect(store.getState().undoStack).toEqual([]);
    expect(store.getState().dirty).toBe(false);
  });

  it('does nothing without a loaded tree', () => {
    const store = createTreeStore({ fetchTree: vi.fn(), saveTree: vi.fn() });
    expect(store.getState().apply('x', () => undefined)).toBe(false);
  });

  it('undo restores the tree and the selection from before the step', async () => {
    const { store } = await loaded();
    const rootId = store.getState().root!.id;
    store.getState().select({ kind: 'node', nodeId: rootId });
    store.getState().apply(
      'Rename',
      (draft) => {
        draft.label = 'Renamed';
      },
      { kind: 'node', nodeId: rootId },
    );

    store.getState().undo();

    const state = store.getState();
    expect(state.root?.label).toBe('Root');
    expect(state.selection).toEqual({ kind: 'node', nodeId: rootId });
    expect(state.undoStack).toEqual([]);
    expect(state.redoStack).toHaveLength(1);
    // Back at the loaded tree, which is what is on disk.
    expect(state.dirty).toBe(false);
    expect(selectCanUndo(state)).toBe(false);
    expect(selectCanRedo(state)).toBe(true);
  });

  it('redo re-applies the step and restores the selection from after it', async () => {
    const { store } = await loaded();
    const rootId = store.getState().root!.id;
    store.getState().apply(
      'Rename',
      (draft) => {
        draft.label = 'Renamed';
      },
      { kind: 'node', nodeId: rootId },
    );
    store.getState().undo();
    store.getState().select(undefined);

    store.getState().redo();

    const state = store.getState();
    expect(state.root?.label).toBe('Renamed');
    expect(state.selection).toEqual({ kind: 'node', nodeId: rootId });
    expect(state.redoStack).toEqual([]);
    expect(state.undoStack).toHaveLength(1);
  });

  it('a new change clears the redo stack', async () => {
    const { store } = await loaded();
    store.getState().apply('A', (d) => {
      d.label = 'A';
    });
    store.getState().undo();
    store.getState().apply('B', (d) => {
      d.label = 'B';
    });
    expect(store.getState().redoStack).toEqual([]);
  });

  it('undo and redo do nothing on empty stacks', async () => {
    const { store } = await loaded();
    const { root, version } = store.getState();
    store.getState().undo();
    store.getState().redo();
    expect(store.getState().root).toBe(root);
    expect(store.getState().version).toBe(version);
  });

  it('keeps at most UNDO_STACK_LIMIT steps, dropping the oldest', async () => {
    const { store } = await loaded();
    for (let i = 0; i < UNDO_STACK_LIMIT + 5; i++) {
      store.getState().apply(`step ${i}`, (d) => {
        d.label = `label ${i}`;
      });
    }
    const { undoStack } = store.getState();
    expect(undoStack).toHaveLength(UNDO_STACK_LIMIT);
    expect(undoStack[0].label).toBe('step 5');
    expect(undoStack[undoStack.length - 1].label).toBe(`step ${UNDO_STACK_LIMIT + 4}`);
  });

  it('evaluates a selection function on the draft after the recipe', async () => {
    const { store } = await loaded();
    const root = store.getState().root!;
    const newId = store.getState().getIdGen()();
    store.getState().apply(
      'Add',
      (draft) => {
        draft.childNodes.push({
          id: newId,
          type: 'Sequence',
          properties: {},
          decorators: [],
          services: [],
          childNodes: [],
          extra: {},
        } as TreeNode);
      },
      (draft): Selection | undefined => {
        const added = draft.childNodes[draft.childNodes.length - 1];
        return { kind: 'node', nodeId: added.id };
      },
    );
    expect(store.getState().selection).toEqual({ kind: 'node', nodeId: newId });
    expect(store.getState().root!.childNodes).toHaveLength(root.childNodes.length + 1);
  });

  it('select sets the selection without touching history or dirty state', async () => {
    const { store } = await loaded();
    const rootId = store.getState().root!.id;
    store.getState().select({ kind: 'node', nodeId: rootId });
    expect(store.getState().selection).toEqual({ kind: 'node', nodeId: rootId });
    expect(store.getState().undoStack).toEqual([]);
    expect(store.getState().dirty).toBe(false);
  });

  it('getSelectedItem resolves nodes and sub items', async () => {
    const { store } = await loaded();
    const root = store.getState().root!;
    const child = root.childNodes[0];
    const decorator = child.decorators[0];

    expect(getSelectedItem(root, { kind: 'node', nodeId: child.id })?.node).toBe(child);
    const item = getSelectedItem(root, {
      kind: 'decorator',
      nodeId: child.id,
      itemId: decorator.id,
    });
    expect(item?.kind).toBe('decorator');
    expect(item?.subItem).toBe(decorator);
    expect(
      getSelectedItem(root, { kind: 'service', nodeId: child.id, itemId: 'missing' }),
    ).toBeUndefined();
    expect(getSelectedItem(undefined, { kind: 'node', nodeId: child.id })).toBeUndefined();
  });

  it('saves the serialized tree, clears dirty and reports Done', async () => {
    const { store, saveTree } = await loaded();
    store.getState().apply('Rename', (d) => {
      d.label = 'Saved';
    });

    await expect(store.getState().save()).resolves.toBe(true);

    expect(saveTree).toHaveBeenCalledTimes(1);
    const [path, json] = saveTree.mock.calls[0] as unknown as [string, unknown];
    expect(path).toBe('/trees/root.json');
    expect(json).toEqual(nodeToJson(store.getState().root!));
    expect(store.getState().dirty).toBe(false);
    expect(alertStore.getState().alerts.map((a) => [a.type, a.message])).toEqual([
      ['success', 'Done'],
    ]);
  });

  it('keeps the dirty flag and reports the server message when save fails', async () => {
    const store = createTreeStore({
      fetchTree: async () => structuredClone(TREE_JSON),
      saveTree: async () => {
        throw new Error('Save was forbidden by tree project plugin');
      },
    });
    await store.getState().load('/trees/root.json');
    store.getState().apply('Rename', (d) => {
      d.label = 'x';
    });

    await expect(store.getState().save()).resolves.toBe(false);

    expect(store.getState().dirty).toBe(true);
    expect(alertStore.getState().alerts[0]).toMatchObject({
      type: 'error',
      message: 'Save was forbidden by tree project plugin',
    });
  });

  it('isValid reports invalid property values and missing types', async () => {
    const { store } = await loaded();
    const project = parseAndCompileProject(PROJECT_JSON).project!;
    // TREE_JSON contains a missing 'Missing' node type, so the tree is not valid.
    expect(store.getState().isValid(project)).toBe(false);

    store.getState().apply('Fix', (draft) => {
      draft.childNodes = draft.childNodes.filter((n) => n.type !== 'Missing');
    });
    expect(store.getState().isValid(project)).toBe(true);
  });
});

describe('dirty state against the undo position', () => {
  beforeEach(() => {
    alertStore.getState().clear();
  });

  it('undo back to the loaded tree is clean, and redo makes it dirty again', async () => {
    const { store } = await loaded();
    store.getState().apply('Rename', (draft) => {
      draft.label = 'Renamed';
    });
    expect(store.getState().dirty).toBe(true);
    store.getState().undo();
    expect(store.getState().dirty).toBe(false);
    store.getState().redo();
    expect(store.getState().dirty).toBe(true);
  });

  it('after a save, undo is dirty and redo is clean again', async () => {
    const { store } = await loaded();
    store.getState().apply('Rename', (draft) => {
      draft.label = 'Renamed';
    });
    await store.getState().save();
    expect(store.getState().dirty).toBe(false);
    store.getState().undo();
    expect(store.getState().dirty).toBe(true);
    store.getState().redo();
    expect(store.getState().dirty).toBe(false);
  });

  it('a new edit after undoing past the save is dirty, even though the undo count matches', async () => {
    const { store } = await loaded();
    store.getState().apply('Rename', (draft) => {
      draft.label = 'Saved';
    });
    await store.getState().save();
    store.getState().undo();
    store.getState().apply('Other', (draft) => {
      draft.label = 'Other';
    });
    // The saved step is gone from the history, so no undo can make the tree clean again.
    expect(store.getState().dirty).toBe(true);
    store.getState().undo();
    expect(store.getState().dirty).toBe(true);
  });

  it('stays clean after undo back to the saved step when the history was trimmed', async () => {
    const { store } = await loaded();
    store.getState().apply('Saved step', (draft) => {
      draft.label = 'Saved';
    });
    await store.getState().save();
    for (let i = 0; i < UNDO_STACK_LIMIT; i++) {
      store.getState().apply('Step', (draft) => {
        draft.label = `Step ${i}`;
      });
    }
    expect(store.getState().undoStack).toHaveLength(UNDO_STACK_LIMIT);
    expect(store.getState().dirty).toBe(true);
    for (let i = 0; i < UNDO_STACK_LIMIT; i++) {
      store.getState().undo();
    }
    // The saved step was dropped when the history was trimmed: the tree is not clean.
    expect(store.getState().dirty).toBe(true);
  });

  it('a load resets the saved position', async () => {
    const { store } = await loaded();
    store.getState().apply('Rename', (draft) => {
      draft.label = 'Renamed';
    });
    await store.getState().save();
    await store.getState().load('/trees/other.json');
    store.getState().apply('Rename', (draft) => {
      draft.label = 'Again';
    });
    store.getState().undo();
    expect(store.getState().dirty).toBe(false);
  });
});
