import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  createIdGen,
  nodeFromJson,
  parseAndCompileProject,
  type CompiledProject,
} from '@owlbt/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TREE_JSON } from '../../test/fixtures';
import { inspectStore } from '../../store/inspectStore';
import { treeStore } from '../../store/treeStore';
import { viewportStore } from '../TreeCanvas/viewportStore';
import { TypeDetails, USAGE_LIMIT } from './TypeDetails';

/** Project with inheritance, constraints, an enum, a custom type and a missing-base-free abstract base. */
const DETAILS_PROJECT = JSON.stringify({
  types: { tagName: { type: 'string', pattern: '[a-z]+' } },
  nodes: [
    { name: 'Sequence', isComposite: true, icon: 'arrow-right', color: '#d08038' },
    { name: 'BaseWait', isAbstract: true, isComposite: false },
    {
      name: 'Wait',
      base: 'BaseWait',
      icon: 'clock',
      description: 'Waits {{duration}} ms in {{Mode}} mode',
      properties: [
        {
          name: 'duration',
          type: 'number',
          min: 0,
          max: 1000,
          default: 100,
          description: 'Time in ms',
        },
        { name: 'Mode', type: 'enum', values: ['fast', 'slow'], default: 'fast' },
        { name: 'tag', type: 'tagName', default: 'abc' },
      ],
    },
    { name: 'Parent', isComposite: true, icon: 'folder' },
    { name: 'Child', base: 'Parent', isComposite: true, icon: 'file' },
  ],
  decorators: [{ name: 'Inverter', icon: 'rotate', description: 'Inverts' }],
  services: [{ name: 'Logger', icon: 'file' }],
});

const UNREFERENCED_PROJECT = JSON.stringify({
  nodes: [{ name: 'Sequence', isComposite: true }],
  services: [{ name: 'Logger' }],
});

function loadTree() {
  const root = nodeFromJson(structuredClone(TREE_JSON), createIdGen('td'));
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

function compile(text: string): CompiledProject {
  const result = parseAndCompileProject(text);
  if (!result.project) {
    throw new Error(result.error);
  }
  return result.project;
}

function renderDetails(
  kind: 'node' | 'decorator' | 'service',
  name: string,
  project = compile(DETAILS_PROJECT),
) {
  return render(
    <TypeDetails kind={kind} name={name} project={project} root={treeStore.getState().root} />,
  );
}

describe('TypeDetails', () => {
  beforeEach(() => {
    loadTree();
    inspectStore.getState().clear();
    viewportStore.setState({ focusSeq: 0, focusNodeId: undefined });
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the header with the kind and the composite chip of a node', () => {
    renderDetails('node', 'Sequence');
    expect(screen.getByText('Sequence')).toBeTruthy();
    expect(screen.getByText('NODE')).toBeTruthy();
    expect(screen.getByText('COMPOSITE')).toBeTruthy();
  });

  it('shows the action chip for a non-composite node and no chip for sub items', () => {
    const { unmount } = renderDetails('node', 'Wait');
    expect(screen.getByText('ACTION')).toBeTruthy();
    unmount();

    renderDetails('decorator', 'Inverter');
    expect(screen.getByText('DECORATOR')).toBeTruthy();
    expect(screen.queryByText('COMPOSITE')).toBeNull();
    expect(screen.queryByText('ACTION')).toBeNull();
  });

  it('shows the description with highlighted placeholders', () => {
    renderDetails('node', 'Wait');
    const placeholder = screen.getByText('{{duration}}');
    expect(placeholder.tagName).toBe('SPAN');
    expect(screen.getByText('{{Mode}}')).toBeTruthy();
    expect(screen.getByText(/Waits/)).toBeTruthy();
  });

  it('shows "No description" when the type has none', () => {
    renderDetails('service', 'Logger');
    expect(screen.getByText('No description')).toBeTruthy();
    expect(screen.getByText('No properties')).toBeTruthy();
  });

  it('lists properties with type, default and constraints', () => {
    renderDetails('node', 'Wait');
    expect(screen.getByText('duration')).toBeTruthy();
    expect(screen.getByText('number')).toBeTruthy();
    expect(screen.getByText('0…1000')).toBeTruthy();
    expect(screen.getByText('Time in ms')).toBeTruthy();
    expect(screen.getByText('100')).toBeTruthy();

    expect(screen.getByText('enum')).toBeTruthy();
    expect(screen.getByText('fast', { selector: 'span' })).toBeTruthy();
    expect(screen.getByText('slow')).toBeTruthy();
  });

  it('shows the custom type name and its pattern', () => {
    renderDetails('node', 'Wait');
    expect(screen.getByText('tagName')).toBeTruthy();
    expect(screen.getByText('/[a-z]+/')).toBeTruthy();
    expect(screen.getByText('"abc"')).toBeTruthy();
  });

  it('shows abstract bases as plain text and non-abstract bases as clickable chips', () => {
    const { unmount } = renderDetails('node', 'Wait');
    const abstractBase = screen.getByText('BaseWait');
    expect(abstractBase.tagName).toBe('SPAN');
    expect(abstractBase.getAttribute('title')).toBe('abstract');
    unmount();

    renderDetails('node', 'Child');
    fireEvent.click(screen.getByRole('button', { name: 'Parent' }));
    expect(inspectStore.getState().inspected).toEqual({ kind: 'node', name: 'Parent' });
  });

  it('shows the usage count and the usages with their location', () => {
    renderDetails('node', 'Wait');
    expect(screen.getByText('Used in this tree: 1')).toBeTruthy();
    expect(screen.getByText('Pause')).toBeTruthy();
    expect(screen.getByText('Root')).toBeTruthy();
  });

  it('shows the decorator usage with the owning node as location', () => {
    renderDetails('decorator', 'Inverter');
    expect(screen.getByText('Used in this tree: 1')).toBeTruthy();
    expect(screen.getByText('Root › Pause')).toBeTruthy();
  });

  it('says when the type is not used in the tree', () => {
    renderDetails('node', 'Parent');
    expect(screen.getByText('Used in this tree: 0')).toBeTruthy();
    expect(screen.getByText('Not used in this tree')).toBeTruthy();
  });

  it('selects a usage and focuses its node', () => {
    const root = treeStore.getState().root;
    const wait = root?.childNodes[0];
    if (!wait) {
      throw new Error('no node');
    }
    renderDetails('node', 'Wait');
    fireEvent.click(screen.getByRole('button', { name: /Pause/ }));

    expect(treeStore.getState().selection).toEqual({ kind: 'node', nodeId: wait.id });
    expect(viewportStore.getState().focusNodeId).toBe(wait.id);
  });

  it('selects a decorator usage as a sub item', () => {
    const wait = treeStore.getState().root?.childNodes[0];
    if (!wait) {
      throw new Error('no node');
    }
    renderDetails('decorator', 'Inverter');
    fireEvent.click(screen.getByRole('button', { name: /Inverter/ }));

    const decorator = wait.decorators[0];
    expect(treeStore.getState().selection).toEqual({
      kind: 'decorator',
      nodeId: wait.id,
      itemId: decorator.id,
    });
  });

  it('caps the usage list and counts the rest', () => {
    const root = treeStore.getState().root;
    if (!root) {
      throw new Error('no tree');
    }
    // One Wait in the fixture plus USAGE_LIMIT + 3 more: the panel lists USAGE_LIMIT and counts the rest.
    const extra = Array.from({ length: USAGE_LIMIT + 3 }, (_, i) => ({
      type: 'Wait',
      label: `W${i}`,
    }));
    const wrapper = nodeFromJson({ type: 'Sequence', childNodes: extra }, createIdGen('x'));
    treeStore.setState({
      root: { ...root, childNodes: [...root.childNodes, ...wrapper.childNodes] },
    });
    renderDetails('node', 'Wait');
    expect(screen.getByText(`+${4} more`)).toBeTruthy();
  });

  it('warns when the type is no longer in the project file', () => {
    renderDetails('node', 'Gone', compile(UNREFERENCED_PROJECT));
    expect(screen.getByText('This type is no longer in the project file')).toBeTruthy();
    expect(screen.queryByText('Properties')).toBeNull();
  });

  it('closes back to the overview by clearing the inspection', () => {
    inspectStore.getState().inspect('node', 'Wait');
    renderDetails('node', 'Wait');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(inspectStore.getState().inspected).toBeUndefined();
  });
});
