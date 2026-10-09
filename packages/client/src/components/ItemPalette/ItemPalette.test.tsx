import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createIdGen, nodeFromJson, type TreeNode } from '@owlbt/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PROJECT_JSON, TREE_JSON } from '../../test/fixtures';
import { projectStore } from '../../store/projectStore';
import { treeStore } from '../../store/treeStore';
import ItemPalette from './ItemPalette';

function loadTree(): TreeNode {
  const root = nodeFromJson(structuredClone(TREE_JSON), createIdGen('ip'));
  treeStore.setState({
    root,
    selection: undefined,
    undoStack: [],
    redoStack: [],
    dirty: false,
    version: 0,
  });
  return root;
}

function itemButton(name: string): HTMLButtonElement {
  return screen.getByText(name).closest('button') as HTMLButtonElement;
}

describe('ItemPalette', () => {
  let root: TreeNode;

  beforeEach(() => {
    localStorage.clear();
    projectStore.getState().applyContent(PROJECT_JSON);
    root = loadTree();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows every group, disabled, when nothing is selected', () => {
    render(<ItemPalette />);
    expect(screen.getByText('Select a node in the tree view to add items')).toBeTruthy();
    for (const group of ['Composite Nodes', 'Action Nodes', 'Services', 'Decorators']) {
      expect(screen.getByText(group)).toBeTruthy();
    }
    expect(itemButton('Sequence').disabled).toBe(true);
    expect(itemButton('Logger').disabled).toBe(true);
  });

  it('keeps node groups visible but disabled for an action node', () => {
    const wait = root.childNodes[0];
    treeStore.getState().select({ kind: 'node', nodeId: wait.id });
    render(<ItemPalette />);

    expect(screen.getByText('Composite Nodes')).toBeTruthy();
    expect(screen.getAllByText('Select a composite node to add child nodes')).toHaveLength(2);
    expect(itemButton('Sequence').disabled).toBe(true);
    expect(itemButton('Wait').disabled).toBe(true);
    expect(itemButton('Inverter').disabled).toBe(false);

    fireEvent.click(itemButton('Logger'));
    expect(treeStore.getState().root?.childNodes[0].services).toHaveLength(1);
  });

  it('adds child nodes to a selected composite node', () => {
    treeStore.getState().select({ kind: 'node', nodeId: root.id });
    render(<ItemPalette />);

    expect(screen.queryByText('Select a composite node to add child nodes')).toBeNull();
    fireEvent.click(itemButton('Wait'));
    expect(treeStore.getState().root?.childNodes).toHaveLength(3);
  });
});
