import { cleanup, render, screen } from '@testing-library/react';
import { createIdGen, nodeFromJson, parseAndCompileProject, type TreeNode } from '@owlbt/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { PROJECT_JSON, TREE_JSON } from '../../test/fixtures';
import { TreeNodeView } from './TreeNodeView';

const project = parseAndCompileProject(PROJECT_JSON).project!;

function tree(): TreeNode {
  return nodeFromJson(structuredClone(TREE_JSON), createIdGen('v'));
}

function renderNode(node: TreeNode, extra: { selectedSubId?: string } = {}) {
  return render(
    <TreeNodeView
      node={node}
      project={project}
      x={0}
      y={0}
      selected={false}
      selectedSubId={extra.selectedSubId}
    />,
  );
}

describe('TreeNodeView', () => {
  afterEach(cleanup);

  it('shows the type name, the label and the rendered description', () => {
    renderNode(tree().childNodes[0]);

    expect(screen.getByText('(Wait)')).toBeTruthy();
    expect(screen.getByText('Pause')).toBeTruthy();
    expect(screen.getByText('Waits 500 ms')).toBeTruthy();
  });

  it('prefixes decorators that invert their condition', () => {
    const { container } = renderNode(tree().childNodes[0]);
    const decorator = container.querySelector('[data-item-kind="decorator"]');
    expect(decorator?.textContent).toContain('[not] Inverter');
  });

  it('renders the comment for the hover tooltip', () => {
    renderNode(tree().childNodes[0]);
    expect(screen.getByText('short wait')).toBeTruthy();
  });

  it('marks items with a missing type as invalid', () => {
    const { container } = renderNode(tree().childNodes[1]);

    const header = container.querySelector('[data-item-kind="node"]');
    expect(header?.getAttribute('data-item-invalid')).toBe('true');
    expect(header?.className).toContain('invalid');
    expect(screen.getByText('Missing')).toBeTruthy();
  });

  it('marks items with invalid property values as invalid', () => {
    const wait = tree().childNodes[0];
    wait.properties.duration = -5;
    const { container } = renderNode(wait);
    expect(
      container.querySelector('[data-item-kind="node"]')?.getAttribute('data-item-invalid'),
    ).toBe('true');
  });

  it('leaves valid items unmarked and applies the sub item selection', () => {
    const wait = tree().childNodes[0];
    const decorator = wait.decorators[0];
    const { container } = renderNode(wait, { selectedSubId: decorator.id });

    const header = container.querySelector('[data-item-kind="node"]');
    expect(header?.getAttribute('data-item-invalid')).toBeNull();
    expect(header?.className).not.toContain('selected');
    const decoratorEl = container.querySelector('[data-item-kind="decorator"]');
    expect(decoratorEl?.className).toContain('selected');
  });
});
