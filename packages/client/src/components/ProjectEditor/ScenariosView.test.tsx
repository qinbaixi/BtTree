import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScenarioTestReport } from '../../lib/api';
import { projectEditorStore } from '../../store/projectEditorStore';
import ProjectEditor from '../../views/ProjectEditor';

const PROJECT_PATH = '/work/owl-bt.json';

const PROJECT = {
  nodes: [{ name: 'Wait' }],
  scenarios: [
    { name: 'Calm', blackboard: { Enemy: false }, custom: 'kept' },
    { name: 'Tested', blackboard: {}, expect: { result: 'success', blackboard: { Ammo: 0 } } },
  ],
};

const REPORT: ScenarioTestReport = {
  projectDir: '/work',
  projectPath: PROJECT_PATH,
  cases: [
    {
      tree: 'trees/a.json',
      treePath: '/work/trees/a.json',
      scenario: 'Tested',
      status: 'fail',
      expect: true,
      result: 'failure',
      ticks: 3,
      maxTicks: 1000,
      failures: ['expected success, got failure'],
      mismatches: [],
      errors: [],
      durationMs: 1,
    },
  ],
  warnings: [],
  summary: { total: 1, passed: 0, failed: 1, ran: 0, errors: 0 },
  ok: false,
};

const mocks = vi.hoisted(() => ({ content: '', runScenarioTests: vi.fn() }));

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return {
    ...actual,
    fetchProjectMeta: vi.fn(async () => ({
      path: '/work/owl-bt.json',
      hash: 'hash-1',
      content: mocks.content,
    })),
    saveProject: vi.fn(async () => ({ hash: 'hash-2' })),
    runScenarioTests: mocks.runScenarioTests,
  };
});

vi.mock('../../store/projectStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/projectStore')>();
  return {
    ...actual,
    defaultSocketFactory: () => ({ on: () => undefined, disconnect: () => undefined }),
  };
});

async function renderScenarios() {
  render(
    <MemoryRouter initialEntries={[`/project?path=${encodeURIComponent(PROJECT_PATH)}`]}>
      <Routes>
        <Route path="/project" element={<ProjectEditor />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole('complementary', { name: 'Project types' });
  act(() => projectEditorStore.getState().select({ view: 'scenarios' }));
  return screen.findByRole('heading', { name: 'Scenarios' });
}

function scenarios() {
  return projectEditorStore.getState().draft?.scenarios ?? [];
}

describe('ScenariosView test expectations', () => {
  beforeEach(() => {
    mocks.content = JSON.stringify(PROJECT, null, 2);
    mocks.runScenarioTests.mockReset();
    projectEditorStore.setState({ dirty: false, undoStack: [], redoStack: [] });
  });

  afterEach(() => {
    cleanup();
    projectEditorStore.getState().disconnect();
  });

  it('edits the expected result, ticks and max ticks', async () => {
    await renderScenarios();
    fireEvent.change(screen.getByRole('combobox', { name: 'Expected result of Calm' }), {
      target: { value: 'failure' },
    });
    expect(scenarios()[0].expect).toEqual({ result: 'failure' });
    expect(scenarios()[0]).toMatchObject({ custom: 'kept' });

    const ticks = screen.getByRole('textbox', { name: 'Expected ticks of Calm' });
    fireEvent.change(ticks, { target: { value: '12' } });
    fireEvent.blur(ticks);
    expect(scenarios()[0].expect).toEqual({ result: 'failure', ticks: 12 });

    const maxTicks = screen.getByRole('textbox', { name: 'Max ticks of Calm' });
    fireEvent.change(maxTicks, { target: { value: '5' } });
    fireEvent.blur(maxTicks);
    expect(scenarios()[0].maxTicks).toBe(5);
    // expect.ticks (12) is larger than maxTicks (5)
    expect(screen.getByText('expect.ticks (12) is larger than maxTicks (5)')).toBeTruthy();

    fireEvent.change(screen.getByRole('combobox', { name: 'Expected result of Calm' }), {
      target: { value: '' },
    });
    fireEvent.change(ticks, { target: { value: '' } });
    fireEvent.blur(ticks);
    expect(scenarios()[0].expect).toBeUndefined();
  });

  it('edits the trees and the expected blackboard', async () => {
    await renderScenarios();
    const trees = screen.getByRole('textbox', { name: 'Trees of Tested' });
    fireEvent.change(trees, { target: { value: 'trees/a.json, trees/*.json' } });
    fireEvent.blur(trees);
    expect(scenarios()[1].trees).toEqual(['trees/a.json', 'trees/*.json']);

    const card = screen.getByRole('region', { name: 'Scenario Tested' });
    fireEvent.click(within(card).getByRole('button', { name: '+ Expected value' }));
    expect(scenarios()[1].expect?.blackboard).toEqual({ Ammo: 0, Key: 0 });
    fireEvent.click(
      within(card).getByRole('button', { name: 'Remove Ammo from Tested (expected)' }),
    );
    fireEvent.click(
      within(card).getByRole('button', { name: 'Remove Key from Tested (expected)' }),
    );
    expect(scenarios()[1].expect).toEqual({ result: 'success' });
    // the start blackboard is untouched
    expect(scenarios()[1].blackboard).toEqual({});
  });

  it('runs the scenario tests with the draft and shows the results', async () => {
    mocks.runScenarioTests.mockResolvedValue(REPORT);
    await renderScenarios();
    fireEvent.click(screen.getByRole('button', { name: 'Run scenario tests' }));
    expect(await screen.findByText('1 scenario test: 0 passed, 1 failed')).toBeTruthy();
    expect(mocks.runScenarioTests).toHaveBeenCalledWith(
      PROJECT_PATH,
      projectEditorStore.getState().draft,
    );
    const table = screen.getByRole('table');
    expect(table.textContent).toContain('trees/a.json');
    expect(table.textContent).toContain('expected success, got failure');
  });

  it('shows configuration errors', async () => {
    mocks.runScenarioTests.mockRejectedValue(new Error('No scenarios defined'));
    await renderScenarios();
    fireEvent.click(screen.getByRole('button', { name: 'Run scenario tests' }));
    expect((await screen.findByRole('alert')).textContent).toBe('No scenarios defined');
  });
});
