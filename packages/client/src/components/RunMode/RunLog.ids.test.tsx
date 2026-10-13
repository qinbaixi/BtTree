import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { compileProject, createIdGen, nodeFromJson, numberTree } from '@owlbt/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { projectStore } from '../../store/projectStore';
import { runStore } from '../../store/runStore';
import { runViewStore } from '../../store/runViewStore';
import { treeStore } from '../../store/treeStore';
import { TreeNodeView } from '../TreeCanvas/TreeNodeView';
import RunLog from './RunLog';

const project = compileProject({
  nodes: [
    { name: 'Sequence', isComposite: true },
    {
      name: 'Fire',
      description: 'Attack with {{Shots}} shots',
      properties: [{ name: 'Shots', type: 'number', default: 1 }],
      simulate: { mode: 'rule', duration: '3' },
    },
  ],
  decorators: [{ name: 'Guard' }],
});

const tree = {
  type: 'Sequence',
  childNodes: [
    {
      type: 'Fire',
      label: 'Shoot',
      properties: [{ name: 'Shots', value: 3 }],
      decorators: [{ type: 'Guard' }],
    },
  ],
};

function load(): string {
  const root = nodeFromJson(tree as never, createIdGen('l'));
  treeStore.setState({ root, selection: undefined });
  projectStore.setState({ project, scenarios: [] });
  runStore.getState().enter();
  return root.childNodes[0].id;
}

describe('run log ids and descriptions', () => {
  beforeEach(() => {
    window.localStorage.clear();
    runViewStore.setState({ showIds: true });
  });
  afterEach(() => {
    cleanup();
    runStore.getState().exit();
    runStore.setState({ overrides: {} });
    treeStore.setState({ root: undefined, selection: undefined });
    projectStore.setState({ project: undefined, scenarios: [] });
    runViewStore.setState({ showIds: true });
  });

  it('shows #id, label, type and description in the collapsed row', () => {
    load();
    act(() => runStore.getState().step());
    render(<RunLog />);
    const row = screen.getByTestId('active-node');
    // Numbering: root 1, decorator 2, node 3.
    expect(within(row).getByTestId('node-id').textContent).toBe('#3');
    expect(row.textContent).toContain('Shoot');
    expect(row.textContent).toContain('(Fire)');
    expect(within(row).getByTestId('node-desc').textContent).toBe('— Attack with 3 shots');
    expect(row.getAttribute('title')).toBe('#3 Shoot (Fire) — Attack with 3 shots');
  });

  it('uses run overrides in the description', () => {
    const id = load();
    act(() => runStore.getState().setOverride(id, 'Shots', 7));
    act(() => runStore.getState().step());
    render(<RunLog />);
    expect(screen.getByTestId('node-desc').textContent).toBe('— Attack with 7 shots');
  });

  it('prefixes detail lines with ids and shows the description on enter lines', () => {
    load();
    act(() => runStore.getState().step());
    render(<RunLog />);
    fireEvent.click(screen.getByRole('button', { name: 'Tick 1' }));
    const trace = screen.getByRole('list', { name: 'Tick 1 entries' });
    const ids = within(trace)
      .getAllByTestId('trace-id')
      .map((n) => n.textContent);
    expect(ids).toContain('#1');
    expect(ids).toContain('#3');
    const descs = within(trace).getAllByTestId('trace-desc');
    expect(descs.map((n) => n.textContent)).toEqual(['Attack with 3 shots']);
  });

  it('hides ids when the toggle is off and persists it', () => {
    load();
    act(() => runStore.getState().step());
    render(<RunLog />);
    const box = screen.getByRole('checkbox', { name: 'Show node ids' }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(screen.queryByTestId('node-id')).toBeNull();
    expect(window.localStorage.getItem('owlbt.runShowIds')).toBe('false');
    fireEvent.click(box);
    expect(screen.getByTestId('node-id')).toBeTruthy();
    expect(window.localStorage.getItem('owlbt.runShowIds')).toBe('true');
  });
});

describe('canvas id badges', () => {
  const root = nodeFromJson(tree as never, createIdGen('c'));
  const node = root.childNodes[0];
  const ids = new Map(numberTree(root).map((n) => [n.item.id, n.id]));
  const props = { node, project, x: 0, y: 0, selected: false };

  afterEach(cleanup);

  it('shows node and decorator badges only in run mode with ids', () => {
    const { container, rerender } = render(<TreeNodeView {...props} runActive exportIds={ids} />);
    const badges = [...container.querySelectorAll('[data-export-id]')].map((n) => n.textContent);
    expect(badges.sort()).toEqual(['#2', '#3']);

    rerender(<TreeNodeView {...props} exportIds={ids} />);
    expect(container.querySelector('[data-export-id]')).toBeNull();

    rerender(<TreeNodeView {...props} runActive />);
    expect(container.querySelector('[data-export-id]')).toBeNull();
  });
});
