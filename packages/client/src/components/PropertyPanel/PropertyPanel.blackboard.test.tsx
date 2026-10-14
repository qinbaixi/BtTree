import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createIdGen, nodeFromJson, type TreeNodeJson } from '@owlbt/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchUsages } from '../../lib/api';
import { setNavigator } from '../../lib/appNavigation';
import { inspectStore } from '../../store/inspectStore';
import { projectStore } from '../../store/projectStore';
import { treeStore } from '../../store/treeStore';
import PropertyPanel from './PropertyPanel';

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, fetchUsages: vi.fn() };
});

const PROJECT = {
  types: { blackboardKey: { type: 'string' } },
  nodes: [
    { name: 'Sequence', isComposite: true },
    {
      name: 'MoveTo',
      properties: [
        { name: 'Target', type: 'blackboardKey' },
        { name: 'Note', type: 'string' },
      ],
    },
  ],
  blackboard: [
    { name: 'Enemy', type: 'bool', description: 'Enemy in sight' },
    { name: 'Home', type: 'string' },
  ],
};

const TREE: TreeNodeJson = {
  type: 'Sequence',
  label: 'Root',
  childNodes: [
    {
      type: 'MoveTo',
      label: 'Go',
      properties: [
        { name: 'Target', value: 'Nowhere' },
        { name: 'Note', value: 'Nowhere' },
      ],
    },
    { type: 'MoveTo', label: 'Back', properties: [{ name: 'Target', value: 'Home' }] },
  ],
};

function load(project: unknown = PROJECT) {
  projectStore.getState().applyContent(JSON.stringify(project));
  const root = nodeFromJson(structuredClone(TREE), createIdGen('b'));
  treeStore.setState({
    root,
    treePath: '/p/trees/t.json',
    selection: undefined,
    undoStack: [],
    redoStack: [],
    dirty: false,
  });
  return root;
}

describe('PropertyPanel blackboard keys', () => {
  beforeEach(() => {
    inspectStore.getState().clear();
    vi.mocked(fetchUsages).mockReset();
  });

  afterEach(() => {
    cleanup();
    setNavigator(undefined);
  });

  it('suggests the declared keys and warns about other names', () => {
    const root = load();
    treeStore.getState().select({ kind: 'node', nodeId: root.childNodes[0].id });
    const { container } = render(<PropertyPanel />);

    const input = screen.getByLabelText('Target') as HTMLInputElement;
    const list = container.querySelector(`#${CSS.escape(input.getAttribute('list') ?? '')}`);
    expect(list?.tagName).toBe('DATALIST');
    expect([...(list?.querySelectorAll('option') ?? [])].map((o) => o.value)).toEqual([
      'Enemy',
      'Home',
    ]);
    expect(screen.getByText("'Nowhere' is not a declared blackboard key")).toBeTruthy();
    // Plain string properties get neither.
    expect((screen.getByLabelText('Note') as HTMLInputElement).getAttribute('list')).toBeNull();
    expect(screen.getAllByText(/is not a declared blackboard key/)).toHaveLength(1);
  });

  it('accepts declared keys', () => {
    const root = load();
    treeStore.getState().select({ kind: 'node', nodeId: root.childNodes[1].id });
    render(<PropertyPanel />);
    expect(screen.queryByText(/is not a declared blackboard key/)).toBeNull();
  });

  it('does not warn when the project declares no keys', () => {
    const root = load({ ...PROJECT, blackboard: undefined });
    treeStore.getState().select({ kind: 'node', nodeId: root.childNodes[0].id });
    render(<PropertyPanel />);
    expect(screen.queryByText(/is not a declared blackboard key/)).toBeNull();
    expect((screen.getByLabelText('Target') as HTMLInputElement).getAttribute('list')).toBeNull();
  });

  it('lists undeclared keys as warnings in the tree overview', () => {
    load();
    render(<PropertyPanel />);
    expect(screen.getByText("Undeclared blackboard key: Target = 'Nowhere'")).toBeTruthy();
  });

  it('finds usages of an inspected type in the project and opens them', async () => {
    load();
    const navigate = vi.fn();
    setNavigator(navigate);
    vi.mocked(fetchUsages).mockResolvedValue({
      projectDir: '/p',
      truncated: false,
      errors: [],
      files: [
        {
          path: '/p/trees/other.json',
          relPath: 'trees/other.json',
          usages: [
            {
              nodePath: [2],
              itemKind: 'node',
              type: 'MoveTo',
              location: 'Root › MoveTo',
            },
          ],
        },
      ],
    });
    inspectStore.getState().inspect('node', 'MoveTo');
    render(<PropertyPanel />);

    fireEvent.click(screen.getByRole('button', { name: /Find usages in project/ }));
    expect(fetchUsages).toHaveBeenCalledWith('/p/trees/t.json', 'node', 'MoveTo');
    fireEvent.click(await screen.findByRole('button', { name: /Root › MoveTo/ }));
    expect(navigate).toHaveBeenCalledWith(
      `/tree?${new URLSearchParams({ path: '/p/trees/other.json', select: 'node:2' })}`,
    );
  });

  it('asks before leaving a tree with unsaved edits', async () => {
    load();
    treeStore.setState({ dirty: true });
    const navigate = vi.fn();
    setNavigator(navigate);
    vi.mocked(fetchUsages).mockResolvedValue({
      projectDir: '/p',
      truncated: false,
      errors: [],
      files: [
        {
          path: '/p/trees/other.json',
          relPath: 'trees/other.json',
          usages: [{ nodePath: [], itemKind: 'node', type: 'MoveTo', location: 'MoveTo' }],
        },
      ],
    });
    inspectStore.getState().inspect('node', 'MoveTo');
    render(<PropertyPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Find usages in project/ }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(await screen.findByTitle('Open trees/other.json and select this item'));
    expect(confirm).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    confirm.mockRestore();
  });
});
