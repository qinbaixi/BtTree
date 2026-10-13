import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { compileProject, createIdGen, nodeFromJson, type TreeNode } from '@owlbt/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectStore } from '../../store/projectStore';
import { runStore } from '../../store/runStore';
import { treeStore } from '../../store/treeStore';
import RunLog from './RunLog';
import RunPanel from './RunPanel';
import RunToolbar from './RunToolbar';

const project = compileProject({
  nodes: [
    { name: 'Sequence', isComposite: true },
    {
      name: 'Wait',
      properties: [{ name: 'Duration', type: 'number', default: 1 }],
      simulate: { mode: 'rule', duration: '{{Duration}}' },
    },
    { name: 'Attack', simulate: { condition: 'Ammo > 0', effects: ['Ammo = Ammo - 1'] } },
    { name: 'Ask' },
  ],
});
const scenarios = [
  { name: 'Armed', description: 'Has ammo', blackboard: { Ammo: 2, Enemy: true } },
  { name: 'Empty', blackboard: { Ammo: 0 } },
];

let root: TreeNode;

function load(json: object): void {
  root = nodeFromJson(json as never, createIdGen('t'));
  treeStore.setState({ root, selection: undefined });
  projectStore.setState({ project, scenarios });
}

describe('run mode components', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.confirm = () => true;
  });
  afterEach(() => {
    cleanup();
    runStore.getState().exit();
    runStore.setState({
      blackboard: [],
      selectedScenario: undefined,
      overrides: {},
      breakpoints: new Set(),
      speed: 2,
      loops: 1,
    });
    treeStore.setState({ root: undefined, selection: undefined });
    projectStore.setState({ project: undefined, scenarios: [] });
  });

  describe('RunToolbar', () => {
    it('shows tick and status and steps through the run', () => {
      load({
        type: 'Sequence',
        childNodes: [{ type: 'Wait', properties: [{ name: 'Duration', value: 1 }] }],
      });
      runStore.getState().enter();
      render(<RunToolbar />);
      expect(screen.getByTestId('run-tick').textContent).toBe('Tick 0');
      expect(screen.getByTestId('run-status').textContent).toBe('Ready');

      fireEvent.click(screen.getByRole('button', { name: /^Step/ }));
      expect(screen.getByTestId('run-tick').textContent).toBe('Tick 1');
      expect(screen.getByTestId('run-status').textContent).toBe('Running');

      fireEvent.click(screen.getByRole('button', { name: /^Step/ }));
      fireEvent.click(screen.getByRole('button', { name: /^Step/ }));
      expect(screen.getByTestId('run-status').textContent).toBe('Success');
      expect(screen.getByRole('button', { name: /^Step/ }).hasAttribute('disabled')).toBe(true);

      fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
      expect(screen.getByTestId('run-tick').textContent).toBe('Tick 0');
    });

    it('has separate Play and Pause buttons with matching enabled states', () => {
      vi.useFakeTimers();
      try {
        load({
          type: 'Sequence',
          childNodes: [{ type: 'Wait', properties: [{ name: 'Duration', value: 50 }] }],
        });
        runStore.getState().enter();
        render(<RunToolbar />);
        const play = () => screen.getByRole('button', { name: /^(Play|Replay)/ });
        const pause = () => screen.getByRole('button', { name: /^Pause/ });
        expect(play().getAttribute('title')).toBe('Play (F8)');
        expect(pause().getAttribute('title')).toBe('Pause (F8)');
        expect(screen.getByRole('button', { name: /^Step/ }).getAttribute('title')).toBe(
          'Step (F10)',
        );
        expect(screen.getByRole('button', { name: /^Reset/ }).getAttribute('title')).toBe('Reset');
        expect(play().hasAttribute('disabled')).toBe(false);
        expect(pause().hasAttribute('disabled')).toBe(true);

        fireEvent.click(play());
        expect(runStore.getState().playing).toBe(true);
        expect(play().hasAttribute('disabled')).toBe(true);
        expect(pause().hasAttribute('disabled')).toBe(false);
        act(() => {
          vi.advanceTimersByTime(1100);
        });
        const ticks = runStore.getState().history.length;
        expect(ticks).toBeGreaterThan(1);

        fireEvent.click(pause());
        expect(runStore.getState().playing).toBe(false);
        expect(play().hasAttribute('disabled')).toBe(false);
        expect(pause().hasAttribute('disabled')).toBe(true);
        act(() => {
          vi.advanceTimersByTime(5000);
        });
        expect(runStore.getState().history.length).toBe(ticks);
      } finally {
        runStore.getState().exit();
        vi.useRealTimers();
      }
    });

    it('offers Replay when the run is finished', () => {
      load({ type: 'Wait' });
      runStore.getState().enter();
      render(<RunToolbar />);
      fireEvent.click(screen.getByRole('button', { name: /^Step/ }));
      fireEvent.click(screen.getByRole('button', { name: /^Step/ }));
      const replay = screen.getByRole('button', { name: /^Replay/ });
      expect(replay.hasAttribute('disabled')).toBe(false);
      expect(replay.getAttribute('title')).toBe('Replay (F8)');
    });

    it('changes the speed', () => {
      load({ type: 'Wait' });
      runStore.getState().enter();
      render(<RunToolbar />);
      fireEvent.change(screen.getByLabelText('Speed in ticks per second'), {
        target: { value: '5' },
      });
      expect(runStore.getState().speed).toBe(5);
      expect(screen.getByText('5 t/s')).toBeTruthy();
    });

    it('offers Succeed and Fail for a manual action', () => {
      load({ type: 'Sequence', childNodes: [{ type: 'Ask', label: 'Confirm' }] });
      runStore.getState().enter();
      render(<RunToolbar />);
      fireEvent.click(screen.getByRole('button', { name: /^Step/ }));
      expect(screen.getByTestId('run-status').textContent).toBe('Waiting for manual result');
      expect(screen.getByText('Confirm (Ask)')).toBeTruthy();
      expect(screen.getByRole('button', { name: /^Step/ }).hasAttribute('disabled')).toBe(true);

      fireEvent.click(screen.getByRole('button', { name: /Succeed/ }));
      expect(screen.queryByRole('button', { name: /Succeed/ })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: /^Step/ }));
      expect(screen.getByTestId('run-status').textContent).toBe('Success');
    });

    it('shows the replay banner and returns to live', () => {
      load({ type: 'Wait', properties: [{ name: 'Duration', value: 3 }] });
      runStore.getState().enter();
      render(<RunToolbar />);
      fireEvent.click(screen.getByRole('button', { name: /^Step/ }));
      fireEvent.click(screen.getByRole('button', { name: /^Step/ }));
      act(() => runStore.getState().seek(1));
      expect(screen.getByRole('status').textContent).toContain('Viewing tick 1 of 2');
      expect(screen.getByTestId('run-tick').textContent).toBe('Tick 1');
      fireEvent.click(screen.getByRole('button', { name: 'back to live' }));
      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.getByTestId('run-tick').textContent).toBe('Tick 2');
    });
  });

  describe('RunLog', () => {
    const setup = () => {
      load({
        type: 'Sequence',
        label: 'Main',
        childNodes: [{ type: 'Attack', label: 'Shoot' }, { type: 'Ask' }],
      });
      runStore.setState({ blackboard: [{ key: 'Ammo', value: 1 }] });
      runStore.getState().enter();
    };

    it('renders one collapsed group per tick with a summary', () => {
      setup();
      runStore.getState().step();
      render(<RunLog />);

      const group = screen.getByRole('button', { name: 'Tick 1' });
      expect(group.getAttribute('aria-expanded')).toBe('false');
      expect(group.textContent).toContain('Tick 1');
      expect(group.textContent).toContain('Ask');
      expect(group.textContent).toContain('Waiting');
      expect(group.textContent).toContain('Ammo 1→0');
      expect(screen.queryByRole('list', { name: 'Tick 1 entries' })).toBeNull();
    });

    it('expands a group into an indented trace and selects the node of a line', () => {
      setup();
      runStore.getState().step();
      render(<RunLog />);

      fireEvent.click(screen.getByRole('button', { name: 'Tick 1' }));
      const trace = screen.getByRole('list', { name: 'Tick 1 entries' });
      const lines = within(trace).getAllByRole('button');
      const rootLine = lines.find((l) => l.getAttribute('data-kind') === 'enter');
      expect(rootLine?.getAttribute('data-depth')).toBe('0');
      expect(rootLine?.querySelector('.fa-arrow-right-to-bracket')).toBeTruthy();
      const diff = lines.find((l) => l.getAttribute('data-kind') === 'blackboard');
      expect(diff?.getAttribute('data-depth')).toBe('1');
      expect(diff?.querySelector('.fa-table')).toBeTruthy();
      expect(diff?.textContent).toContain('Shoot');
      expect(diff?.textContent).toContain('Ammo: 1 → 0');
      const result = lines.find(
        (l) => l.getAttribute('data-kind') === 'result' && l.textContent?.includes('success'),
      );
      expect(result?.querySelector('.fa-circle-check')).toBeTruthy();

      fireEvent.click(diff as HTMLElement);
      expect(treeStore.getState().selection).toEqual({
        kind: 'node',
        nodeId: root.childNodes[0].id,
      });

      // Kind filters apply to the expanded details only.
      fireEvent.click(screen.getByLabelText('Enter'));
      expect(
        within(trace)
          .getAllByRole('button')
          .some((l) => l.getAttribute('data-kind') === 'enter'),
      ).toBe(false);
      expect(screen.getByRole('button', { name: 'Tick 1' }).textContent).toContain('Ammo 1→0');

      fireEvent.click(screen.getByRole('button', { name: 'Tick 1' }));
      expect(screen.queryByRole('list', { name: 'Tick 1 entries' })).toBeNull();
    });

    it('expands and collapses all groups', () => {
      setup();
      runStore.getState().step();
      runStore.getState().resolveManual('success');
      runStore.getState().step();
      render(<RunLog />);

      fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
      expect(screen.getByRole('list', { name: 'Tick 1 entries' })).toBeTruthy();
      expect(screen.getByRole('list', { name: 'Tick 2 entries' })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
      expect(screen.queryByRole('list', { name: 'Tick 1 entries' })).toBeNull();
      expect(screen.queryByRole('list', { name: 'Tick 2 entries' })).toBeNull();
    });

    it('shows the finished tree in the summary', () => {
      load({ type: 'Sequence', childNodes: [{ type: 'Ask' }] });
      runStore.getState().enter();
      runStore.getState().step();
      act(() => runStore.getState().resolveManual('success'));
      runStore.getState().step();
      render(<RunLog />);
      const texts = screen
        .getAllByRole('button', { name: /^Tick \d+$/ })
        .map((g) => g.textContent ?? '');
      expect(texts[texts.length - 1]).toContain('Tree finished: Success');
    });

    it('opens groups that contain errors', () => {
      load({ type: 'Attack' });
      projectStore.setState({
        project: compileProject({
          nodes: [{ name: 'Attack', simulate: { condition: 'Ammo >' } }],
        }),
      });
      runStore.getState().enter();
      runStore.getState().step();
      expect(runStore.getState().history[1].log.some((e) => e.kind === 'error')).toBe(true);
      render(<RunLog />);
      const group = screen.getByRole('button', { name: 'Tick 1' });
      expect(group.getAttribute('aria-expanded')).toBe('true');
      expect(group.textContent).toContain('Tree finished: Failure');
      expect(screen.getByRole('list', { name: 'Tick 1 entries' })).toBeTruthy();
    });

    it('seeks to a tick with the view button and highlights it', () => {
      setup();
      runStore.getState().step();
      runStore.getState().resolveManual('success');
      runStore.getState().step();
      render(<RunLog />);
      expect(runStore.getState().viewIndex).toBe(2);
      fireEvent.click(screen.getByRole('button', { name: 'View tick 1' }));
      expect(runStore.getState().viewIndex).toBe(1);
      const current = document.querySelector('[data-current="true"]');
      expect(current?.getAttribute('data-tick')).toBe('1');
    });

    it('resizes with the keyboard, persists the height and resets on double click', () => {
      setup();
      render(<RunLog />);
      const handle = screen.getByRole('separator', { name: 'Resize run log' });
      expect(handle.getAttribute('aria-orientation')).toBe('horizontal');
      expect(handle.getAttribute('aria-valuenow')).toBe('240');
      fireEvent.keyDown(handle, { key: 'ArrowUp' });
      expect(handle.getAttribute('aria-valuenow')).toBe('260');
      expect(window.localStorage.getItem('owlbt.runLogHeight')).toBe('260');
      fireEvent.keyDown(handle, { key: 'ArrowDown' });
      fireEvent.keyDown(handle, { key: 'ArrowDown' });
      expect(handle.getAttribute('aria-valuenow')).toBe('220');
      for (let i = 0; i < 10; i++) fireEvent.keyDown(handle, { key: 'ArrowDown' });
      expect(handle.getAttribute('aria-valuenow')).toBe('120');
      fireEvent.doubleClick(handle);
      expect(handle.getAttribute('aria-valuenow')).toBe('240');
    });

    it('replays with the timeline slider and collapses', () => {
      load({ type: 'Wait', properties: [{ name: 'Duration', value: 2 }] });
      runStore.getState().enter();
      runStore.getState().step();
      runStore.getState().step();
      render(<RunLog />);
      const slider = screen.getByLabelText('Timeline') as HTMLInputElement;
      expect(slider.max).toBe('2');
      expect(slider.value).toBe('2');
      fireEvent.change(slider, { target: { value: '1' } });
      expect(runStore.getState().viewIndex).toBe(1);
      expect(screen.getByRole('button', { name: 'live' })).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Collapse run log' }));
      expect(screen.queryByRole('list', { name: 'Run log entries' })).toBeNull();
    });
  });

  describe('RunPanel', () => {
    it('loads a scenario from the select and shows its description', () => {
      load({ type: 'Wait' });
      runStore.getState().enter();
      render(<RunPanel />);
      const select = screen.getByLabelText('Scenario') as HTMLSelectElement;
      expect(select.value).toBe('Armed');
      expect(screen.getByText('Has ammo')).toBeTruthy();
      expect(screen.getByLabelText('Value of Ammo')).toHaveProperty('value', '2');

      fireEvent.change(select, { target: { value: 'Empty' } });
      expect(runStore.getState().selectedScenario).toBe('Empty');
      expect(screen.getByLabelText('Value of Ammo')).toHaveProperty('value', '0');
      expect(screen.queryByLabelText('Key Enemy')).toBeNull();
    });

    it('shows live values, highlights changed keys and read-only past ticks', () => {
      load({ type: 'Sequence', childNodes: [{ type: 'Attack' }] });
      runStore.getState().enter();
      render(<RunPanel />);
      const row = () => screen.getByLabelText('Value of Ammo').closest('li');
      expect(row()?.getAttribute('data-changed')).toBeNull();

      act(() => runStore.getState().step());
      expect(screen.getByLabelText('Value of Ammo')).toHaveProperty('value', '1');
      expect(row()?.getAttribute('data-changed')).toBe('true');
      expect(screen.getByLabelText('Value of Enemy')).toHaveProperty('checked', true);
      expect(
        screen.getByLabelText('Value of Enemy').closest('li')?.getAttribute('data-changed'),
      ).toBeNull();

      act(() => runStore.getState().seek(0));
      expect(screen.getByLabelText('Value of Ammo')).toHaveProperty('value', '2');
      expect(screen.getByLabelText('Value of Ammo')).toHaveProperty('disabled', true);
      expect(screen.getByText(/read-only/)).toBeTruthy();
    });

    it('edits values, types and keys of the blackboard', () => {
      load({ type: 'Sequence', childNodes: [{ type: 'Attack' }] });
      runStore.getState().enter();
      act(() => runStore.getState().step());
      render(<RunPanel />);

      fireEvent.change(screen.getByLabelText('Value of Ammo'), { target: { value: '5' } });
      expect(runStore.getState().history[1].blackboard.Ammo).toBe(5);
      expect(runStore.getState().blackboard[0]).toEqual({ key: 'Ammo', value: 5 });

      fireEvent.click(screen.getByLabelText('Value of Enemy'));
      expect(runStore.getState().history[1].blackboard.Enemy).toBe(false);

      fireEvent.change(screen.getByLabelText('Type of Ammo'), { target: { value: 'string' } });
      expect(runStore.getState().blackboard[0].value).toBe('5');

      fireEvent.change(screen.getByLabelText('Key Ammo'), { target: { value: 'Shots' } });
      expect(runStore.getState().history[1].blackboard).toMatchObject({ Shots: '5' });
      expect(runStore.getState().history[1].blackboard.Ammo).toBeUndefined();

      fireEvent.click(screen.getByRole('button', { name: /Add key/ }));
      expect(screen.getByLabelText('Key Key')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Remove Key' }));
      expect(screen.queryByLabelText('Key Key')).toBeNull();
    });

    it('lists keys created during the run as runtime keys', () => {
      load({ type: 'Sequence', childNodes: [{ type: 'Attack' }] });
      runStore.getState().enter();
      act(() => runStore.getState().setBlackboardValue('Extra', 1));
      // simulate a key created by an effect
      act(() => {
        const history = runStore.getState().history.slice();
        history[0] = { ...history[0], blackboard: { ...history[0].blackboard, Made: 'x' } };
        runStore.setState({ history });
      });
      render(<RunPanel />);
      expect(screen.getByText('Made')).toBeTruthy();
      expect(screen.getByText('runtime')).toBeTruthy();
    });

    it('overrides the properties of the selected node and clears them', () => {
      load({
        type: 'Sequence',
        childNodes: [{ type: 'Wait', properties: [{ name: 'Duration', value: 4 }] }],
      });
      const wait = root.childNodes[0];
      treeStore.setState({ selection: { kind: 'node', nodeId: wait.id } });
      runStore.getState().enter();
      render(<RunPanel />);

      const input = screen.getByLabelText('Override Duration') as HTMLInputElement;
      expect(input.value).toBe('4');
      expect(screen.getByRole('button', { name: /Clear overrides/ }).hasAttribute('disabled')).toBe(
        true,
      );
      fireEvent.change(input, { target: { value: '1' } });
      expect(runStore.getState().overrides).toEqual({ [wait.id]: { Duration: 1 } });
      expect(input.closest('li')?.getAttribute('data-overridden')).toBe('true');

      fireEvent.click(screen.getByRole('button', { name: /Clear overrides \(1\)/ }));
      expect(runStore.getState().overrides).toEqual({});
      expect((screen.getByLabelText('Override Duration') as HTMLInputElement).value).toBe('4');
    });

    it('asks for a node when nothing is selected', () => {
      load({ type: 'Wait' });
      runStore.getState().enter();
      render(<RunPanel />);
      expect(screen.getByText(/Select a node, decorator or service/)).toBeTruthy();
    });
  });
  describe('looped runs', () => {
    const loopTree = { type: 'Sequence', childNodes: [{ type: 'Wait' }] };

    it('persists the Loops value and clamps invalid input', () => {
      load(loopTree);
      runStore.getState().enter();
      render(<RunToolbar />);
      const input = screen.getByRole('spinbutton', { name: 'Loops' }) as HTMLInputElement;
      expect(input.value).toBe('1');
      expect(input.closest('label')?.getAttribute('title')).toBe(
        'Number of times the tree runs. 0 = loop forever.',
      );

      fireEvent.change(input, { target: { value: '4' } });
      expect(runStore.getState().loops).toBe(4);
      expect(window.localStorage.getItem('owlbt.runLoops')).toBe('4');

      fireEvent.change(input, { target: { value: '-3' } });
      expect(runStore.getState().loops).toBe(4);
      fireEvent.blur(input);
      expect(runStore.getState().loops).toBe(0);
      expect(input.value).toBe('0');

      fireEvent.change(input, { target: { value: '2.7' } });
      fireEvent.blur(input);
      expect(runStore.getState().loops).toBe(2);

      fireEvent.change(input, { target: { value: '' } });
      fireEvent.blur(input);
      expect(runStore.getState().loops).toBe(1);
      expect(window.localStorage.getItem('owlbt.runLoops')).toBe('1');
    });

    it('shows Run x/y and the final summary', () => {
      load(loopTree);
      runStore.getState().setLoops(2);
      runStore.getState().enter();
      render(<RunToolbar />);
      expect(screen.getByTestId('run-pass').textContent).toBe('Run 1/2');
      for (let i = 0; i < 3; i++) act(() => runStore.getState().step());
      expect(screen.getByTestId('run-pass').textContent).toBe('Run 2/2');
      for (let i = 0; i < 2; i++) act(() => runStore.getState().step());
      expect(screen.getByTestId('run-finished').textContent).toBe('Finished after 2 runs: Success');
    });

    it('shows the endless counter and hides it for a single run', () => {
      load(loopTree);
      runStore.getState().enter();
      render(<RunToolbar />);
      act(() => runStore.getState().step());
      expect(screen.queryByTestId('run-pass')).toBeNull();
      act(() => runStore.getState().setLoops(0));
      expect(screen.getByTestId('run-pass').textContent).toBe('Run 1/∞');
    });

    it('marks runs in the log with badges, result pills and dividers', () => {
      load(loopTree);
      runStore.getState().setLoops(2);
      runStore.getState().enter();
      for (let i = 0; i < 3; i++) runStore.getState().step();
      render(<RunLog />);
      expect(screen.getAllByTestId('run-badge').map((n) => n.textContent)).toEqual([
        'Run 1',
        'Run 1',
        'Run 2',
      ]);
      const dividers = screen.getAllByTestId('pass-divider');
      expect(dividers.map((n) => n.textContent)).toEqual(['Run 2']);
      expect(screen.getByTestId('pass-result').textContent).toBe('Run finished: Success');

      fireEvent.click(screen.getByRole('button', { name: 'Tick 3' }));
      const trace = screen.getByRole('list', { name: 'Tick 3 entries' });
      expect(trace.textContent).toContain('Run 2/2 started');
    });

    it('does not mark single runs', () => {
      load(loopTree);
      runStore.getState().enter();
      runStore.getState().step();
      render(<RunLog />);
      expect(screen.queryByTestId('run-badge')).toBeNull();
      expect(screen.queryByTestId('pass-divider')).toBeNull();
    });

    it('notes dropped ticks in the log', () => {
      load(loopTree);
      runStore.getState().enter();
      runStore.getState().step();
      runStore.setState({ dropped: 12 });
      render(<RunLog />);
      expect(screen.getByTestId('log-dropped').textContent).toBe('Older ticks were dropped');
    });
  });
});
