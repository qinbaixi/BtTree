import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  createIdGen,
  nodeFromJson,
  parseAndCompileProject,
  type TreeNodeJson,
} from '@owlbt/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWorkspace } from '../../lib/api';
import { PROJECT_JSON, TREE_JSON } from '../../test/fixtures';
import { inspectStore } from '../../store/inspectStore';
import { projectStore } from '../../store/projectStore';
import { treeStore } from '../../store/treeStore';
import { viewportStore } from '../TreeCanvas/viewportStore';
import { clearProjectPathCache, PROBLEM_LIMIT, TreeOverview, treeDirectory } from './TreeOverview';
import { findTypeUsages, summarizeTree } from './treeInspect';

vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  fetchWorkspace: vi.fn(),
}));

const fetchWorkspaceMock = vi.mocked(fetchWorkspace);

function loadTree(json: TreeNodeJson = TREE_JSON, treePath?: string) {
  const root = nodeFromJson(structuredClone(json), createIdGen('to'));
  treeStore.setState({
    root,
    treePath,
    selection: undefined,
    undoStack: [],
    redoStack: [],
    dirty: false,
    loading: false,
    error: undefined,
    version: 0,
  });
  return root;
}

/** Value tile of a statistic, e.g. statValue('Nodes') === '3'. */
function statValue(label: string): string | null {
  // Group titles in "Types used" share some labels; only the stat labels have a value tile before them.
  const label_ = screen.getAllByText(label).find((el) => el.previousElementSibling !== null);
  return label_?.previousElementSibling?.textContent ?? null;
}

describe('TreeOverview', () => {
  beforeEach(() => {
    projectStore.getState().applyContent(PROJECT_JSON);
    loadTree(TREE_JSON, undefined);
    inspectStore.getState().clear();
    clearProjectPathCache();
    fetchWorkspaceMock.mockReset();
    fetchWorkspaceMock.mockResolvedValue({ dir: '', trees: [], truncated: false });
    viewportStore.setState({ focusSeq: 0, focusNodeId: undefined });
  });

  afterEach(() => {
    cleanup();
  });

  it('shows statistics of the tree', () => {
    render(
      <TreeOverview project={projectStore.getState().project} root={treeStore.getState().root} />,
    );
    // Sequence (root, composite), Wait (action), Missing (node of an unknown type)
    expect(statValue('Nodes')).toBe('3');
    expect(statValue('Composite')).toBe('1');
    expect(statValue('Actions')).toBe('1');
    expect(statValue('Decorators')).toBe('1');
    expect(statValue('Services')).toBe('1');
    expect(statValue('Max depth')).toBe('2');
  });

  it('lists the missing type as a problem and selects it when clicked', () => {
    const root = treeStore.getState().root;
    render(<TreeOverview project={projectStore.getState().project} root={root} />);

    expect(screen.getByText('Problems: 1')).toBeTruthy();
    expect(screen.getByText("Missing type 'Missing'")).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Missing type 'Missing'/ }));
    expect(treeStore.getState().selection).toEqual({
      kind: 'node',
      nodeId: root?.childNodes[1].id,
    });
    expect(viewportStore.getState().focusNodeId).toBe(root?.childNodes[1].id);
  });

  it('reports invalid properties of an item', () => {
    loadTree({
      type: 'Sequence',
      childNodes: [{ type: 'Wait', properties: [{ name: 'duration', value: -5 }] }],
    });
    render(
      <TreeOverview project={projectStore.getState().project} root={treeStore.getState().root} />,
    );
    expect(screen.getByText('Invalid: duration')).toBeTruthy();
  });

  it('shows a success message when the tree has no problems', () => {
    loadTree({ type: 'Sequence', childNodes: [{ type: 'Wait' }] });
    render(
      <TreeOverview project={projectStore.getState().project} root={treeStore.getState().root} />,
    );
    expect(screen.getByText('No problems found')).toBeTruthy();
  });

  it('caps the problem list and counts the rest', () => {
    const children = Array.from({ length: PROBLEM_LIMIT + 2 }, () => ({ type: 'Missing' }));
    loadTree({ type: 'Sequence', childNodes: children });
    render(
      <TreeOverview project={projectStore.getState().project} root={treeStore.getState().root} />,
    );
    expect(screen.getByText('+2 more')).toBeTruthy();
  });

  it('lists the types used per kind with their counts and inspects a type when clicked', () => {
    render(
      <TreeOverview project={projectStore.getState().project} root={treeStore.getState().root} />,
    );
    expect(screen.getByText('Types used')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Missing×1/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Inverter/ }));
    expect(inspectStore.getState().inspected).toEqual({ kind: 'decorator', name: 'Inverter' });
  });

  it('shows the dirty status', () => {
    const { unmount } = render(
      <TreeOverview project={projectStore.getState().project} root={treeStore.getState().root} />,
    );
    expect(screen.getByText('All changes saved')).toBeTruthy();
    unmount();

    act(() => {
      treeStore.setState({ dirty: true });
    });
    render(
      <TreeOverview project={projectStore.getState().project} root={treeStore.getState().root} />,
    );
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
  });

  it('loads the project path of the tree folder once and shows it', async () => {
    fetchWorkspaceMock.mockResolvedValue({
      dir: 'C:\\trees',
      projectPath: 'C:\\trees\\owl-bt.json',
      trees: [],
      truncated: false,
    });
    loadTree(TREE_JSON, 'C:\\trees\\demo.json');
    const { unmount } = render(
      <TreeOverview project={projectStore.getState().project} root={treeStore.getState().root} />,
    );
    expect(screen.getByText('Loading…')).toBeTruthy();

    expect(await screen.findByText('C:\\trees\\owl-bt.json')).toBeTruthy();
    expect(fetchWorkspaceMock).toHaveBeenCalledWith('C:\\trees');
    unmount();

    render(
      <TreeOverview project={projectStore.getState().project} root={treeStore.getState().root} />,
    );
    expect(await screen.findByText('C:\\trees\\owl-bt.json')).toBeTruthy();
    expect(fetchWorkspaceMock).toHaveBeenCalledTimes(1);
  });

  it('hides the project row when the workspace cannot be read', async () => {
    fetchWorkspaceMock.mockRejectedValue(new Error('offline'));
    loadTree(TREE_JSON, '/trees/demo.json');
    render(
      <TreeOverview project={projectStore.getState().project} root={treeStore.getState().root} />,
    );

    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
    expect(screen.queryByText('Project')).toBeNull();
  });

  it('shows a message while the project is not loaded', () => {
    render(<TreeOverview project={undefined} root={treeStore.getState().root} />);
    expect(screen.getByText('Loading project...')).toBeTruthy();
  });

  it('shows a message when no tree is loaded', () => {
    render(<TreeOverview project={projectStore.getState().project} root={undefined} />);
    expect(screen.getByText('No tree loaded')).toBeTruthy();
  });
});

describe('treeDirectory', () => {
  it('returns the folder of a tree path for both separator styles', () => {
    expect(treeDirectory('/trees/demo.json')).toBe('/trees');
    expect(treeDirectory('C:\\trees\\demo.json')).toBe('C:\\trees');
    expect(treeDirectory('/demo.json')).toBe('/');
    expect(treeDirectory('demo.json')).toBe('.');
  });
});

describe('treeInspect', () => {
  it('summarizes a tree against a project', () => {
    const project = parseAndCompileProject(PROJECT_JSON).project;
    if (!project) {
      throw new Error('bad project');
    }
    const root = nodeFromJson(structuredClone(TREE_JSON), createIdGen('ti'));
    const summary = summarizeTree(root, project);
    expect(summary.maxDepth).toBe(2);
    expect(summary.usedTypes.node.map((t) => [t.name, t.count, t.missing])).toEqual([
      ['Missing', 1, true],
      ['Sequence', 1, false],
      ['Wait', 1, false],
    ]);
  });

  it('finds usages with their location, in tree order', () => {
    const root = nodeFromJson(structuredClone(TREE_JSON), createIdGen('tu'));
    expect(findTypeUsages(root, 'service', 'Logger')).toEqual([
      { nodeId: root.id, itemId: root.services[0].id, label: 'log', path: 'Root' },
    ]);
    expect(findTypeUsages(undefined, 'node', 'Wait')).toEqual([]);
  });
});
