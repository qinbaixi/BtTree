import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  createIdGen,
  findNode,
  nodeFromJson,
  type Selection,
  type TreeNode,
  type TreeNodeJson,
} from '@owlbt/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PROJECT_JSON, TREE_JSON } from '../../test/fixtures';
import { inspectStore } from '../../store/inspectStore';
import { projectStore } from '../../store/projectStore';
import { treeStore } from '../../store/treeStore';
import PropertyPanel from './PropertyPanel';

/** Puts a tree into the shared tree store (no load, so no network). */
function loadTree(json: TreeNodeJson = TREE_JSON): TreeNode {
  const root = nodeFromJson(structuredClone(json), createIdGen('p'));
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

function select(selection: Selection | undefined): void {
  treeStore.getState().select(selection);
}

function rootNode(): TreeNode {
  const root = treeStore.getState().root;
  if (!root) {
    throw new Error('no tree');
  }
  return root;
}

function renderPanel() {
  return render(<PropertyPanel />);
}

describe('PropertyPanel', () => {
  beforeEach(() => {
    projectStore.getState().applyContent(PROJECT_JSON);
    loadTree();
    inspectStore.getState().clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the tree overview when nothing is selected', () => {
    renderPanel();
    expect(screen.getByText('Select a node to edit its properties')).toBeTruthy();
    expect(screen.getByText('Statistics')).toBeTruthy();
  });

  it('shows the inspected type over the selection, then the selection again when closed', () => {
    const wait = rootNode().childNodes[0];
    select({ kind: 'node', nodeId: wait.id });
    renderPanel();
    expect(screen.getByLabelText('Label')).toBeTruthy();

    act(() => {
      inspectStore.getState().inspect('node', 'Sequence');
    });
    expect(screen.queryByLabelText('Label')).toBeNull();
    expect(screen.getByText('Description')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByLabelText('Label')).toBeTruthy();
  });

  it('clears the inspected type when a tree item is selected', () => {
    renderPanel();
    act(() => {
      inspectStore.getState().inspect('service', 'Logger');
    });
    expect(screen.getByText('Used in this tree: 1')).toBeTruthy();

    act(() => {
      select({ kind: 'node', nodeId: rootNode().id });
    });
    expect(screen.queryByText('Used in this tree: 1')).toBeNull();
    expect(screen.getByLabelText('Label')).toBeTruthy();
  });

  it('commits a label as one undoable change and re-syncs the input on undo', () => {
    const root = rootNode();
    const wait = root.childNodes[0];
    select({ kind: 'node', nodeId: wait.id });
    renderPanel();

    const input = screen.getByLabelText('Label') as HTMLInputElement;
    expect(input.value).toBe('Pause');
    fireEvent.change(input, { target: { value: 'Renamed' } });
    fireEvent.blur(input);

    expect(findNode(rootNode(), wait.id)?.label).toBe('Renamed');
    expect(treeStore.getState().undoStack.at(-1)?.label).toBe('Set Label');

    act(() => {
      treeStore.getState().undo();
    });
    expect((screen.getByLabelText('Label') as HTMLInputElement).value).toBe('Pause');
  });

  it('commits on Enter and clears a base property when the input is emptied', () => {
    const wait = rootNode().childNodes[0];
    select({ kind: 'node', nodeId: wait.id });
    renderPanel();

    const input = screen.getByLabelText('Label') as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(findNode(rootNode(), wait.id)?.label).toBeUndefined();
    expect(treeStore.getState().undoStack).toHaveLength(1);
  });

  it('stores a number edit, and keeps an out-of-range value that is shown as invalid', () => {
    const wait = rootNode().childNodes[0];
    select({ kind: 'node', nodeId: wait.id });
    renderPanel();

    const duration = screen.getByLabelText('duration') as HTMLInputElement;
    expect(duration.value).toBe('500');
    expect(duration.getAttribute('data-invalid')).toBeNull();

    fireEvent.change(duration, { target: { value: '-5' } });
    fireEvent.blur(duration);
    expect(findNode(rootNode(), wait.id)?.properties.duration).toBe(-5);
    expect(
      (screen.getByLabelText('duration') as HTMLInputElement).getAttribute('data-invalid'),
    ).toBe('true');
    expect(treeStore.getState().undoStack.at(-1)?.label).toBe('Set duration');
  });

  it('resets an explicit value to the default with an undoable step', () => {
    const wait = rootNode().childNodes[0];
    select({ kind: 'node', nodeId: wait.id });
    renderPanel();

    fireEvent.click(screen.getByLabelText('Reset duration'));
    expect(findNode(rootNode(), wait.id)?.properties).toEqual({});
    expect(screen.queryByLabelText('Reset duration')).toBeNull();
    const shown = screen.getByLabelText('duration') as HTMLInputElement;
    expect(shown.value).toBe('100');
    expect(shown.getAttribute('data-default')).toBe('true');

    act(() => {
      treeStore.getState().undo();
    });
    expect((screen.getByLabelText('duration') as HTMLInputElement).value).toBe('500');
  });

  it('shows the default of an unset property dimmed, without a reset button', () => {
    const root = loadTree({ type: 'Sequence', childNodes: [{ type: 'Wait' }] });
    const wait = root.childNodes[0];
    select({ kind: 'node', nodeId: wait.id });
    renderPanel();

    const shown = screen.getByLabelText('duration') as HTMLInputElement;
    expect(shown.value).toBe('100');
    expect(shown.getAttribute('data-default')).toBe('true');
    expect(screen.queryByLabelText('Reset duration')).toBeNull();
  });

  it('toggles decorator flags as undoable changes', () => {
    const wait = rootNode().childNodes[0];
    const decorator = wait.decorators[0];
    select({ kind: 'decorator', nodeId: wait.id, itemId: decorator.id });
    renderPanel();

    const inverse = screen.getByLabelText('Inverse check condition') as HTMLInputElement;
    expect(inverse.checked).toBe(true);
    fireEvent.click(inverse);
    expect(
      (findNode(rootNode(), wait.id)?.decorators[0] as { inverseCheckCondition?: boolean })
        .inverseCheckCondition,
    ).toBeUndefined();
    expect(treeStore.getState().undoStack.at(-1)?.label).toBe('Set Inverse check condition');
    expect((screen.getByLabelText('Inverse check condition') as HTMLInputElement).checked).toBe(
      false,
    );
  });

  it('shows an error for a node whose type is missing from the project', () => {
    const missing = rootNode().childNodes[1];
    select({ kind: 'node', nodeId: missing.id });
    renderPanel();
    expect(screen.getByText('Error: Missing descriptor in project file')).toBeTruthy();
    expect(screen.queryByText('Custom properties')).toBeNull();
  });
});
