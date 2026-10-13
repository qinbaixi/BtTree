import { cleanup, fireEvent, render } from '@testing-library/react';
import { createIdGen, nodeFromJson, parseAndCompileProject, type TreeNode } from '@owlbt/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { PROJECT_JSON, TREE_JSON } from '../../test/fixtures';
import { runStore } from '../../store/runStore';
import { TreeNodeView } from './TreeNodeView';

const project = parseAndCompileProject(PROJECT_JSON).project!;

function wait(): TreeNode {
  return nodeFromJson(structuredClone(TREE_JSON), createIdGen('v')).childNodes[0];
}

describe('TreeNodeView in run mode', () => {
  afterEach(() => {
    cleanup();
    runStore.setState({ breakpoints: new Set() });
  });

  it('shows nothing run related outside run mode', () => {
    const { container } = render(
      <TreeNodeView node={wait()} project={project} x={0} y={0} selected={false} />,
    );
    expect(container.querySelector('[data-run-status]')).toBeNull();
    expect(container.querySelector('[data-breakpoint]')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });

  it.each(['idle', 'running', 'success', 'failure'] as const)('marks a %s node', (status) => {
    const { container } = render(
      <TreeNodeView
        node={wait()}
        project={project}
        x={0}
        y={0}
        selected={false}
        runActive
        runStatus={status}
      />,
    );
    const card = container.querySelector('[data-node-id]');
    expect(card?.getAttribute('data-run-status')).toBe(status);
    expect(card?.className).toContain(`run_${status}`);
    expect(container.querySelector('.fa-check') !== null).toBe(status === 'success');
    expect(container.querySelector('.fa-xmark') !== null).toBe(status === 'failure');
  });

  it('shows pass / fail on decorators and ran on services', () => {
    const node = nodeFromJson(
      {
        type: 'Wait',
        decorators: [{ type: 'Inverter' }, { type: 'Inverter' }],
        services: [{ type: 'Logger' }],
      },
      createIdGen('s'),
    );
    const { container } = render(
      <TreeNodeView
        node={node}
        project={project}
        x={0}
        y={0}
        selected={false}
        runActive
        runStatus="running"
        subStatuses={{
          [node.decorators[0].id]: 'pass',
          [node.decorators[1].id]: 'fail',
          [node.services[0].id]: 'ran',
        }}
      />,
    );
    const states = [...container.querySelectorAll('[data-sub-status]')].map((el) =>
      el.getAttribute('data-sub-status'),
    );
    expect(states).toEqual(['pass', 'fail', 'ran']);
  });

  it('toggles a breakpoint with the dot on the card', () => {
    const node = wait();
    const { container, rerender } = render(
      <TreeNodeView node={node} project={project} x={0} y={0} selected={false} runActive />,
    );
    const dot = container.querySelector('button[aria-label="Toggle breakpoint"]') as HTMLElement;
    expect(dot.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(dot);
    expect(runStore.getState().breakpoints.has(node.id)).toBe(true);

    rerender(
      <TreeNodeView
        node={node}
        project={project}
        x={0}
        y={0}
        selected={false}
        runActive
        breakpoint
      />,
    );
    const set = container.querySelector('button[data-breakpoint="true"]');
    expect(set?.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(set as HTMLElement);
    expect(runStore.getState().breakpoints.has(node.id)).toBe(false);
  });
});
