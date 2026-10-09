import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createIdGen, nodeFromJson, type TreeNode } from '@owlbt/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PROJECT_JSON, TREE_JSON } from '../../test/fixtures';
import { inspectStore } from '../../store/inspectStore';
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

function infoButton(name: string): HTMLButtonElement {
  return screen.getByLabelText(`Show details of ${name}`) as HTMLButtonElement;
}

describe('ItemPalette', () => {
  let root: TreeNode;

  beforeEach(() => {
    localStorage.clear();
    projectStore.getState().applyContent(PROJECT_JSON);
    root = loadTree();
    inspectStore.getState().clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows every group, enabled, when nothing is selected', () => {
    render(<ItemPalette />);
    expect(
      screen.getByText('Click a type to see its definition, or select a node to add items'),
    ).toBeTruthy();
    for (const group of ['Composite Nodes', 'Action Nodes', 'Services', 'Decorators']) {
      expect(screen.getByText(group)).toBeTruthy();
    }
    expect(itemButton('Sequence').disabled).toBe(false);
    expect(itemButton('Logger').disabled).toBe(false);
  });

  it('inspects a type when nothing is selected, without adding anything', () => {
    render(<ItemPalette />);
    fireEvent.click(itemButton('Wait'));

    expect(inspectStore.getState().inspected).toEqual({ kind: 'node', name: 'Wait' });
    expect(treeStore.getState().root?.childNodes).toHaveLength(2);
    expect(treeStore.getState().undoStack).toHaveLength(0);
  });

  it('inspects a decorator type with its kind', () => {
    render(<ItemPalette />);
    fireEvent.click(itemButton('Inverter'));
    expect(inspectStore.getState().inspected).toEqual({ kind: 'decorator', name: 'Inverter' });
  });

  it('shows an info button per row that inspects the type', () => {
    render(<ItemPalette />);
    fireEvent.click(infoButton('Logger'));
    expect(inspectStore.getState().inspected).toEqual({ kind: 'service', name: 'Logger' });
  });

  it('info button inspects with a node selected without adding the item', () => {
    treeStore.getState().select({ kind: 'node', nodeId: root.id });
    render(<ItemPalette />);

    expect(infoButton('Wait').disabled).toBe(false);
    fireEvent.click(infoButton('Wait'));

    expect(inspectStore.getState().inspected).toEqual({ kind: 'node', name: 'Wait' });
    expect(treeStore.getState().root?.childNodes).toHaveLength(2);
    expect(treeStore.getState().undoStack).toHaveLength(0);
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
    expect(inspectStore.getState().inspected).toBeUndefined();
  });
});
