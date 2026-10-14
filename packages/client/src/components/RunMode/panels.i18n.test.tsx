import { cleanup, render, screen } from '@testing-library/react';
import { compileProject, createIdGen, nodeFromJson, type TickResult } from '@owlbt/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { getLanguage, setLanguage } from '../../i18n';
import { projectStore } from '../../store/projectStore';
import { runStore } from '../../store/runStore';
import { treeStore } from '../../store/treeStore';
import { TreeOverview } from '../PropertyPanel/TreeOverview';
import RunPanel from './RunPanel';
import RunToolbar from './RunToolbar';
import { finishedLabel, passLabel } from './runHelpers';

const project = compileProject({
  nodes: [
    { name: 'Sequence', isComposite: true },
    { name: 'Wait', simulate: { mode: 'rule', duration: 1 } },
  ],
});

describe('panels in Chinese', () => {
  const initial = getLanguage();
  afterEach(() => {
    cleanup();
    runStore.getState().exit();
    treeStore.setState({ root: undefined, selection: undefined });
    projectStore.setState({ project: undefined, scenarios: [] });
    setLanguage(initial);
  });

  it('translates the run toolbar and run panel', () => {
    setLanguage('zh');
    const root = nodeFromJson(
      { type: 'Sequence', childNodes: [{ type: 'Wait' }] } as never,
      createIdGen('zh'),
    );
    treeStore.setState({ root, selection: undefined });
    projectStore.setState({ project, scenarios: [] });
    runStore.getState().enter();
    render(
      <>
        <RunToolbar />
        <RunPanel />
      </>,
    );
    expect(screen.getByRole('button', { name: /单步/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /重置/ })).toBeTruthy();
    expect(screen.getByTestId('run-status').textContent).toBe('就绪');
    expect(screen.getByText('节点参数')).toBeTruthy();
    expect(screen.getByText('另存为场景…')).toBeTruthy();
  });

  it('translates run labels and the empty tree overview', () => {
    setLanguage('zh');
    const tick = { tick: 9, pass: 3, passes: 5, finished: 'success' } as TickResult;
    expect(passLabel(tick)).toBe('第 3/5 轮');
    expect(finishedLabel(tick)).toBe('运行 3 轮后结束：成功');
    render(<TreeOverview project={undefined} root={undefined} />);
    expect(screen.getByText('未加载树')).toBeTruthy();
  });
});
