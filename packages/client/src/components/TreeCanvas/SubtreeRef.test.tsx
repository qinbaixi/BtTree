import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  createIdGen,
  nodeFromJson,
  parseAndCompileProject,
  type TreeNode,
  type TreeNodeJson,
} from '@owlbt/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commandContext, getCommand } from '../../commands/registry';
import {
  OPEN_SUBTREE_COMMAND_ID,
  openSubtreeFile,
  subtreeFilePath,
  subtreeTargetOf,
  treeEditorUrl,
} from '../../commands/subtreeCommands';
import { setNavigator } from '../../lib/appNavigation';
import { inspectStore } from '../../store/inspectStore';
import { projectStore } from '../../store/projectStore';
import { subtreeStore } from '../../store/subtreeStore';
import { treeStore } from '../../store/treeStore';
import PropertyPanel from '../PropertyPanel/PropertyPanel';
import { summarizeTree } from '../PropertyPanel/treeInspect';
import { TreeNodeView } from './TreeNodeView';

const PROJECT = JSON.stringify({
  nodes: [
    { name: 'Sequence', isComposite: true },
    { name: 'Act' },
    { name: 'SubTree', subtree: true, icon: 'diagram-project' },
  ],
});
const project = parseAndCompileProject(PROJECT).project!;

const TREE: TreeNodeJson = {
  type: 'Sequence',
  childNodes: [
    {
      type: 'SubTree',
      label: 'Common',
      properties: [{ name: 'Tree', value: 'trees/patrol.json' }],
    },
    { type: 'SubTree', properties: [{ name: 'Tree', value: 'trees/gone.json' }] },
    { type: 'Act' },
  ],
};

function load(): TreeNode {
  const root = nodeFromJson(structuredClone(TREE), createIdGen('s'));
  treeStore.setState({ root, selection: undefined, undoStack: [], redoStack: [], dirty: false });
  subtreeStore.setState({
    treePath: '/p/trees/main.json',
    projectDir: '/p',
    self: 'trees/main.json',
    library: {
      'trees/patrol.json': {
        path: '/p/trees/patrol.json',
        tree: {
          type: 'Sequence',
          label: 'Patrol root',
          childNodes: [{ type: 'Act', label: 'Walk' }, { type: 'Act' }],
        },
      },
      'trees/gone.json': {
        error: 'missing',
        message: "Referenced tree 'trees/gone.json' not found",
      },
    },
  });
  subtreeStore.getState().recompute();
  return root;
}

describe('subtree references in the editor', () => {
  let navigated: string[];

  beforeEach(() => {
    projectStore.getState().applyContent(PROJECT);
    inspectStore.getState().clear();
    navigated = [];
    setNavigator((url) => navigated.push(url));
  });

  afterEach(() => {
    cleanup();
    setNavigator(undefined);
    subtreeStore.getState().reset(undefined);
    vi.restoreAllMocks();
  });

  it('shows the referenced tree on the node card with a distinct look', () => {
    const root = load();
    const { container } = render(
      <TreeNodeView node={root.childNodes[0]} project={project} x={0} y={0} selected={false} />,
    );
    const card = container.querySelector('[data-node-id]');
    expect(card?.getAttribute('data-subtree')).toBe('true');
    expect(card?.className).toContain('subtreeNode');
    expect(card?.className).not.toContain('nodeInvalid');
    expect(screen.getByText('patrol')).toBeTruthy();
  });

  it('marks nodes whose referenced tree is missing as invalid', () => {
    const root = load();
    const { container } = render(
      <TreeNodeView node={root.childNodes[1]} project={project} x={0} y={0} selected={false} />,
    );
    expect(container.querySelector('[data-node-id]')?.className).toContain('nodeInvalid');
    expect(container.querySelector('[data-subtree-problem="missing"]')).toBeTruthy();
    expect(screen.getByText("Referenced tree 'trees/gone.json' not found")).toBeTruthy();
  });

  it('opens the referenced tree on double-click', async () => {
    const root = load();
    const { container } = render(
      <TreeNodeView node={root.childNodes[0]} project={project} x={0} y={0} selected={false} />,
    );
    await act(async () => {
      fireEvent.doubleClick(container.querySelector('[data-node-id]') as Element);
    });
    expect(navigated).toEqual([treeEditorUrl('/p/trees/patrol.json')]);
  });

  it('offers the command for subtree nodes and opens them without saving (tabs keep edits)', async () => {
    const root = load();
    const command = getCommand(OPEN_SUBTREE_COMMAND_ID);
    expect(command).toBeDefined();
    treeStore.getState().select({ kind: 'node', nodeId: root.childNodes[2].id });
    expect(command?.canExec(commandContext)).toBe(false);
    treeStore.getState().select({ kind: 'node', nodeId: root.childNodes[0].id });
    expect(command?.canExec(commandContext)).toBe(true);

    treeStore.setState({ dirty: true });
    const confirm = vi.spyOn(window, 'confirm');
    const save = vi.fn(async () => true);
    treeStore.setState({ save });
    await command?.exec(commandContext);
    expect(confirm).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(navigated).toEqual([treeEditorUrl('/p/trees/patrol.json')]);
  });

  it('does not open missing trees', async () => {
    const root = load();
    const target = subtreeTargetOf(root.childNodes[1], commandContext);
    expect(target).toEqual({ ref: 'trees/gone.json', path: '/p/trees/gone.json', loaded: false });
    expect(await openSubtreeFile(treeStore, target!)).toBe(false);
    expect(navigated).toEqual([]);
  });

  it('builds file paths in the style of the project folder', () => {
    expect(subtreeFilePath('/p/', 'trees/a.json')).toBe('/p/trees/a.json');
    expect(subtreeFilePath('C:\\proj', 'trees/a.json')).toBe('C:\\proj\\trees\\a.json');
  });

  it('edits the reference in its own section with a preview of the referenced tree', () => {
    const root = load();
    treeStore.getState().select({ kind: 'node', nodeId: root.childNodes[0].id });
    render(<PropertyPanel />);
    expect(screen.getByText('Subtree')).toBeTruthy();
    expect(screen.getByLabelText('Referenced tree preview').textContent).toContain(
      'Patrol root (Sequence)',
    );
    expect(screen.getByText('Walk (Act)')).toBeTruthy();

    const input = screen.getByLabelText('Tree') as HTMLInputElement;
    expect(input.value).toBe('trees/patrol.json');
    fireEvent.change(input, { target: { value: 'trees/other.json' } });
    fireEvent.blur(input);
    expect(treeStore.getState().root?.childNodes[0].properties.Tree).toBe('trees/other.json');
  });

  it('lists subtree problems in the tree overview', () => {
    const root = load();
    const summary = summarizeTree(root, project, subtreeStore.getState().problems);
    expect(summary.problems.map((p) => p.message)).toEqual([
      "Referenced tree 'trees/gone.json' not found",
    ]);
  });
});
