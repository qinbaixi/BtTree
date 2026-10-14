import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  createIdGen,
  nodeFromJson,
  parseAndCompileProject,
  type TreeNode,
  type TreeNodeJson,
} from '@owlbt/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROJECT_JSON } from '../../test/fixtures';
import { collapseStore } from '../../store/collapseStore';
import { projectStore } from '../../store/projectStore';
import { runStore } from '../../store/runStore';
import { searchStore } from '../../store/searchStore';
import { treeStore } from '../../store/treeStore';
import TreeCanvas from './TreeCanvas';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const project = parseAndCompileProject(PROJECT_JSON).project!;

/** Sequence [ Wait "first", Sequence "group" [ Wait "inner" ], Wait "last" ] */
const TREE: TreeNodeJson = {
  type: 'Sequence',
  label: 'Root',
  childNodes: [
    { type: 'Wait', label: 'first', properties: [{ name: 'duration', value: 250 }] },
    {
      type: 'Sequence',
      label: 'group',
      decorators: [{ type: 'Inverter', label: 'flip' }],
      childNodes: [{ type: 'Wait', label: 'inner' }],
    },
    { type: 'Wait', label: 'last', services: [{ type: 'Logger', label: 'flip log' }] },
  ],
};

let root: TreeNode;

function nodeIds() {
  const [first, group, last] = root.childNodes;
  return {
    root: root.id,
    first: first.id,
    group: group.id,
    inner: group.childNodes[0].id,
    last: last.id,
  };
}

function card(container: HTMLElement, id: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
}

beforeEach(() => {
  window.localStorage.clear();
  root = nodeFromJson(structuredClone(TREE), createIdGen('e'));
  projectStore.setState({ project });
  treeStore.setState({
    root,
    treePath: 'trees/edit.json',
    loadCount: 1,
    selection: undefined,
    undoStack: [],
    redoStack: [],
  });
  collapseStore.getState().set([]);
  searchStore.setState({ open: false, query: '', index: -1 });
  runStore.setState({ active: false });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, 'elementFromPoint');
});

describe('TreeCanvas collapse', () => {
  it('hides descendants of a collapsed node and shows the hidden count', () => {
    const { container } = render(<TreeCanvas />);
    const ids = nodeIds();
    expect(card(container, ids.inner)).not.toBeNull();

    const toggle = card(container, ids.group)!.querySelector('[data-collapse-toggle]')!;
    expect(toggle.getAttribute('data-collapse-toggle')).toBe('expanded');
    fireEvent.click(toggle);

    expect(card(container, ids.inner)).toBeNull();
    const badge = card(container, ids.group)!.querySelector('[data-collapse-toggle]')!;
    expect(badge.textContent).toBe('+1');
    expect(card(container, ids.group)!.getAttribute('data-collapsed')).toBe('true');
    // Leaves have no toggle.
    expect(card(container, ids.first)!.querySelector('[data-collapse-toggle]')).toBeNull();
    // Never written into the tree.
    expect(treeStore.getState().undoStack).toHaveLength(0);

    fireEvent.click(badge);
    expect(card(container, ids.inner)).not.toBeNull();
  });

  it('expands collapsed ancestors when a hidden node is selected', () => {
    const { container } = render(<TreeCanvas />);
    const ids = nodeIds();
    act(() => collapseStore.getState().toggle(ids.group));
    expect(card(container, ids.inner)).toBeNull();
    act(() => treeStore.getState().select({ kind: 'node', nodeId: ids.inner }));
    expect(card(container, ids.inner)).not.toBeNull();
  });
});

describe('TreeCanvas search', () => {
  it('counts, highlights and jumps through matches', () => {
    const { container } = render(<TreeCanvas />);
    const ids = nodeIds();
    act(() => searchStore.getState().show());

    const input = screen.getByRole('textbox', { name: 'Find in tree' });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: 'FLIP' } });

    const count = screen.getByTestId('tree-search-count');
    expect(count.textContent).toBe('0 / 2');
    const hits = container.querySelectorAll('[data-search-hit]');
    expect([...hits].map((el) => el.getAttribute('data-item-kind'))).toEqual([
      'decorator',
      'service',
    ]);

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(count.textContent).toBe('1 / 2');
    const decoratorId = root.childNodes[1].decorators[0].id;
    expect(treeStore.getState().selection).toEqual({
      kind: 'decorator',
      nodeId: ids.group,
      itemId: decoratorId,
    });
    expect(
      container.querySelector('[data-search-hit="current"]')?.getAttribute('data-item-id'),
    ).toBe(decoratorId);

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(count.textContent).toBe('2 / 2');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(count.textContent).toBe('1 / 2');
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(count.textContent).toBe('2 / 2');

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(searchStore.getState().open).toBe(false);
    expect(container.querySelector('[data-search-hit]')).toBeNull();
  });

  it('matches property values and expands collapsed ancestors on jump', () => {
    const { container } = render(<TreeCanvas />);
    const ids = nodeIds();
    act(() => collapseStore.getState().toggle(ids.group));
    act(() => searchStore.getState().show());
    const input = screen.getByRole('textbox', { name: 'Find in tree' });

    fireEvent.change(input, { target: { value: '250' } });
    expect(screen.getByTestId('tree-search-count').textContent).toBe('0 / 1');
    expect(card(container, ids.first)?.getAttribute('data-search-hit')).toBe('true');

    fireEvent.change(input, { target: { value: 'inner' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(treeStore.getState().selection).toEqual({ kind: 'node', nodeId: ids.inner });
    expect(card(container, ids.inner)?.getAttribute('data-search-hit')).toBe('current');
  });
});

describe('TreeCanvas drag and drop', () => {
  /** Gives each card a 100x40 box: x = 200 * index, y = 0 (rows split the card vertically). */
  function placeCards(container: HTMLElement, order: string[]): void {
    order.forEach((id, index) => {
      const element = card(container, id)!;
      const rect = {
        left: index * 200,
        top: 0,
        width: 100,
        height: 40,
        right: index * 200 + 100,
        bottom: 40,
        x: index * 200,
        y: 0,
      };
      element.getBoundingClientRect = () => ({ ...rect, toJSON: () => rect }) as DOMRect;
    });
  }

  function stubHit(container: HTMLElement, order: string[]): void {
    document.elementFromPoint = (x: number) => {
      const index = Math.floor(x / 200);
      const id = order[index];
      if (id === undefined || x - index * 200 > 100) {
        return container.firstElementChild;
      }
      return card(container, id)!.querySelector('[data-item-kind="node"]');
    };
  }

  function drag(container: HTMLElement, fromId: string, toX: number): void {
    const header = card(container, fromId)!.querySelector('[data-item-kind="node"]')!;
    const start = Math.floor(toX / 1000);
    fireEvent.pointerDown(header, { button: 0, clientX: start, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: start + 30, clientY: 10, buttons: 1 });
    fireEvent.pointerMove(window, { clientX: toX, clientY: 10, buttons: 1 });
  }

  it('moves a node before a sibling as one undoable step', () => {
    const { container } = render(<TreeCanvas />);
    const ids = nodeIds();
    const order = [ids.first, ids.group, ids.last];
    placeCards(container, order);
    stubHit(container, order);

    // Drag "last" onto the left half of "first" (a non-composite: before it).
    drag(container, ids.last, 10);
    expect(container.querySelector('[data-drop-indicator="line"]')).not.toBeNull();
    expect(card(container, ids.last)!.getAttribute('data-dragging')).toBe('true');
    fireEvent.pointerUp(window, { clientX: 10, clientY: 10 });

    const state = treeStore.getState();
    expect(state.root!.childNodes.map((n) => n.id)).toEqual([ids.last, ids.first, ids.group]);
    expect(state.undoStack).toHaveLength(1);
    expect(state.selection).toEqual({ kind: 'node', nodeId: ids.last });
    expect(container.querySelector('[data-drop-indicator]')).toBeNull();

    act(() => treeStore.getState().undo());
    expect(treeStore.getState().root!.childNodes.map((n) => n.id)).toEqual(order);
  });

  it('drops into the middle of a composite as its last child', () => {
    const { container } = render(<TreeCanvas />);
    const ids = nodeIds();
    const order = [ids.first, ids.group, ids.last];
    placeCards(container, order);
    stubHit(container, order);

    drag(container, ids.first, 250);
    expect(container.querySelector('[data-drop-indicator="box"]')).not.toBeNull();
    fireEvent.pointerUp(window, { clientX: 250, clientY: 10 });

    const group = treeStore.getState().root!.childNodes.find((n) => n.id === ids.group)!;
    expect(group.childNodes.map((n) => n.id)).toEqual([ids.inner, ids.first]);
  });

  it('refuses drops into a non-composite node and Escape cancels', () => {
    const { container } = render(<TreeCanvas />);
    const ids = nodeIds();
    const order = [ids.first, ids.group, ids.last, ids.inner];
    placeCards(container, order);
    stubHit(container, order);

    // Hovering the dragged node itself: no target.
    drag(container, ids.group, 250);
    expect(container.querySelector('[data-drop-indicator]')).toBeNull();
    // Its own descendant: not allowed.
    fireEvent.pointerMove(window, { clientX: 610, clientY: 10, buttons: 1 });
    expect(container.querySelector('[data-drop-indicator]')).toBeNull();
    expect(container.firstElementChild!.className).toContain('dragInvalid');
    fireEvent.pointerUp(window, { clientX: 610, clientY: 10 });
    expect(container.firstElementChild!.className).not.toContain('dragInvalid');
    expect(treeStore.getState().undoStack).toHaveLength(0);

    drag(container, ids.first, 410);
    expect(container.querySelector('[data-drop-indicator="line"]')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(container.querySelector('[data-drop-indicator]')).toBeNull();
    fireEvent.pointerUp(window, { clientX: 410, clientY: 10 });
    expect(treeStore.getState().undoStack).toHaveLength(0);
  });

  it('moves a decorator to another node', () => {
    const { container } = render(<TreeCanvas />);
    const ids = nodeIds();
    const order = [ids.first, ids.group, ids.last];
    placeCards(container, order);
    stubHit(container, order);
    const decoratorId = root.childNodes[1].decorators[0].id;

    const row = container.querySelector(`[data-item-id="${decoratorId}"]`)!;
    fireEvent.pointerDown(row, { button: 0, clientX: 210, clientY: 30 });
    fireEvent.pointerMove(window, { clientX: 250, clientY: 30, buttons: 1 });
    fireEvent.pointerMove(window, { clientX: 450, clientY: 10, buttons: 1 });
    expect(container.querySelector('[data-drop-indicator="line"]')).not.toBeNull();
    fireEvent.pointerUp(window, { clientX: 450, clientY: 10 });

    const [, group, last] = treeStore.getState().root!.childNodes;
    expect(group.decorators).toHaveLength(0);
    expect(last.decorators.map((d) => d.id)).toEqual([decoratorId]);
    expect(treeStore.getState().selection).toEqual({
      kind: 'decorator',
      nodeId: ids.last,
      itemId: decoratorId,
    });
  });

  it('a press without movement still selects; dragging is off in run mode', () => {
    const { container } = render(<TreeCanvas />);
    const ids = nodeIds();
    const order = [ids.first, ids.group, ids.last];
    placeCards(container, order);
    stubHit(container, order);

    const header = card(container, ids.last)!.querySelector('[data-item-kind="node"]')!;
    fireEvent.pointerDown(header, { button: 0, clientX: 450, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 452, clientY: 11, buttons: 1 });
    fireEvent.pointerUp(window, { clientX: 452, clientY: 11 });
    fireEvent.click(header);
    expect(treeStore.getState().selection).toEqual({ kind: 'node', nodeId: ids.last });
    expect(treeStore.getState().undoStack).toHaveLength(0);

    act(() => runStore.setState({ active: true }));
    drag(container, ids.last, 10);
    fireEvent.pointerUp(window, { clientX: 10, clientY: 10 });
    expect(treeStore.getState().undoStack).toHaveLength(0);
    expect(container.querySelector('[data-drop-indicator]')).toBeNull();
  });
});
