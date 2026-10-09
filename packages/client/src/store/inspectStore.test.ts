import { createIdGen, nodeFromJson } from '@owlbt/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { TREE_JSON } from '../test/fixtures';
import { inspectStore } from './inspectStore';
import { treeStore } from './treeStore';

describe('inspectStore', () => {
  beforeEach(() => {
    const root = nodeFromJson(structuredClone(TREE_JSON), createIdGen('is'));
    treeStore.setState({ root, selection: undefined, undoStack: [], redoStack: [], dirty: false });
    inspectStore.getState().clear();
  });

  it('inspects a type and clears it', () => {
    inspectStore.getState().inspect('decorator', 'Inverter');
    expect(inspectStore.getState().inspected).toEqual({ kind: 'decorator', name: 'Inverter' });

    inspectStore.getState().clear();
    expect(inspectStore.getState().inspected).toBeUndefined();
  });

  it('replaces the inspected type', () => {
    inspectStore.getState().inspect('node', 'Wait');
    inspectStore.getState().inspect('service', 'Logger');
    expect(inspectStore.getState().inspected).toEqual({ kind: 'service', name: 'Logger' });
  });

  it('is cleared when a tree item is selected', () => {
    const root = treeStore.getState().root;
    if (!root) {
      throw new Error('no tree');
    }
    inspectStore.getState().inspect('node', 'Wait');
    treeStore.getState().select({ kind: 'node', nodeId: root.id });
    expect(inspectStore.getState().inspected).toBeUndefined();
  });

  it('is kept when the selection is cleared (background click clears it explicitly)', () => {
    inspectStore.getState().inspect('node', 'Wait');
    treeStore.getState().select(undefined);
    expect(inspectStore.getState().inspected).toEqual({ kind: 'node', name: 'Wait' });
  });

  it('is kept when an edit does not change the selection', () => {
    const root = treeStore.getState().root;
    if (!root) {
      throw new Error('no tree');
    }
    treeStore.getState().select({ kind: 'node', nodeId: root.id });
    inspectStore.getState().inspect('node', 'Wait');
    treeStore.getState().apply('Set Label', (draft) => {
      draft.label = 'Renamed';
    });
    expect(inspectStore.getState().inspected).toEqual({ kind: 'node', name: 'Wait' });
  });

  it('is cleared when a tree load starts or completes', () => {
    inspectStore.getState().inspect('node', 'Wait');
    treeStore.setState({ loading: true });
    expect(inspectStore.getState().inspected).toBeUndefined();

    inspectStore.getState().inspect('node', 'Wait');
    treeStore.setState((state) => ({ loading: false, loadCount: state.loadCount + 1 }));
    expect(inspectStore.getState().inspected).toBeUndefined();
  });
});
