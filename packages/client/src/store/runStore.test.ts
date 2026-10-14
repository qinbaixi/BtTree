import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  compileProject,
  createIdGen,
  nodeFromJson,
  type CompiledProject,
  type ProjectFile,
  type ScenarioJson,
  type TreeNode,
  type TreeNodeJson,
} from '@owlbt/shared';
import { ApiError } from '../lib/api';
import {
  createRunStore,
  entriesToRecord,
  MAX_HISTORY,
  selectCanStepBack,
  type RunStore,
  type RunStoreDeps,
} from './runStore';

const PROJECT_FILE: ProjectFile = {
  nodes: [
    { name: 'Sequence', isComposite: true },
    { name: 'Selector', isComposite: true },
    { name: 'Succeed', simulate: { mode: 'success' } },
    {
      name: 'Wait',
      properties: [{ name: 'Duration', type: 'number', default: 1 }],
      simulate: { mode: 'rule', duration: '{{Duration}}' },
    },
    { name: 'Attack', simulate: { condition: 'Ammo > 0', effects: ['Ammo = Ammo - 1'] } },
    { name: 'Ask' },
  ],
  scenarios: [
    { name: 'Armed', blackboard: { Ammo: 2 } },
    { name: 'Empty', blackboard: { Ammo: 0 } },
  ],
};

const project: CompiledProject = compileProject(PROJECT_FILE);

function tree(json: TreeNodeJson): TreeNode {
  return nodeFromJson(json, createIdGen());
}

const SIMPLE: TreeNodeJson = {
  type: 'Sequence',
  label: 'root',
  childNodes: [
    { type: 'Wait', label: 'wait', properties: [{ name: 'Duration', value: 2 }] },
    { type: 'Attack', label: 'attack' },
  ],
};

interface Harness {
  store: RunStore;
  deps: RunStoreDeps;
  root: TreeNode;
  notifications: string[];
  saved: Array<{ path: string; content: Record<string, unknown>; baseHash: string }>;
  id: (label: string) => string;
}

function setup(
  json: TreeNodeJson = SIMPLE,
  extra: Partial<RunStoreDeps> = {},
  scenarios: ScenarioJson[] = PROJECT_FILE.scenarios ?? [],
): Harness {
  const root = tree(json);
  const notifications: string[] = [];
  const saved: Harness['saved'] = [];
  const deps: RunStoreDeps = {
    getTree: () => ({ root, treePath: '/p/trees/t.json' }),
    getProject: () => project,
    getScenarios: () => scenarios,
    fetchMeta: vi.fn(async () => ({
      path: '/p/owl-bt.json',
      hash: 'h1',
      content: JSON.stringify(PROJECT_FILE),
    })),
    saveProject: vi.fn(async (path, body) => {
      saved.push({
        path,
        content: body.content as Record<string, unknown>,
        baseHash: body.baseHash,
      });
      return { hash: 'h2' };
    }),
    focus: vi.fn(),
    select: vi.fn(),
    notify: {
      error: (m) => notifications.push(`error: ${m}`),
      success: (m) => notifications.push(`success: ${m}`),
      info: (m) => notifications.push(`info: ${m}`),
    },
    ...extra,
  };
  const ids = new Map<string, string>();
  const collect = (n: TreeNode): void => {
    if (n.label) ids.set(n.label, n.id);
    n.childNodes.forEach(collect);
  };
  collect(root);
  return {
    store: createRunStore(deps),
    deps,
    root,
    notifications,
    saved,
    id: (label) => ids.get(label) as string,
  };
}

describe('runStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('enters run mode with the first scenario and exits again', () => {
    const h = setup();
    expect(h.store.getState().enter()).toBe(true);
    const state = h.store.getState();
    expect(state.active).toBe(true);
    expect(state.selectedScenario).toBe('Armed');
    expect(entriesToRecord(state.blackboard)).toEqual({ Ammo: 2 });
    expect(state.history).toHaveLength(1);
    expect(state.history[0].tick).toBe(0);

    state.exit();
    expect(h.store.getState().active).toBe(false);
    expect(h.store.getState().history).toEqual([]);
  });

  it('refuses to enter without a tree or project', () => {
    const h = setup(SIMPLE, { getProject: () => undefined });
    expect(h.store.getState().enter()).toBe(false);
    expect(h.store.getState().active).toBe(false);
    expect(h.notifications[0]).toContain('needs a loaded tree');
  });

  it('steps one tick at a time', () => {
    const h = setup();
    h.store.getState().enter();
    h.store.getState().step();
    h.store.getState().step();
    const state = h.store.getState();
    expect(state.history.map((r) => r.tick)).toEqual([0, 1, 2]);
    expect(state.viewIndex).toBe(2);
    expect(state.history[1].statuses[h.id('wait')]).toBe('running');
  });

  it('stops stepping when the run finished and reset starts over', () => {
    const h = setup();
    h.store.getState().enter();
    for (let i = 0; i < 6; i++) h.store.getState().step();
    const state = h.store.getState();
    expect(state.history[state.history.length - 1].finished).toBe('success');
    expect(state.history).toHaveLength(4);
    h.store.getState().reset();
    expect(h.store.getState().history).toHaveLength(1);
    expect(h.store.getState().viewIndex).toBe(0);
  });

  it('plays at the chosen speed until the run finishes', () => {
    const h = setup();
    h.store.getState().enter();
    h.store.getState().setSpeed(4);
    h.store.getState().play();
    expect(h.store.getState().playing).toBe(true);
    vi.advanceTimersByTime(249);
    expect(h.store.getState().history).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(h.store.getState().history).toHaveLength(2);
    vi.advanceTimersByTime(250 * 5);
    const state = h.store.getState();
    expect(state.playing).toBe(false);
    expect(state.history[state.history.length - 1].finished).toBe('success');
  });

  it('clamps the speed to 0.5 - 10 ticks per second', () => {
    const h = setup();
    h.store.getState().setSpeed(100);
    expect(h.store.getState().speed).toBe(10);
    h.store.getState().setSpeed(0);
    expect(h.store.getState().speed).toBe(0.5);
  });

  it('pauses on a breakpoint and focuses the node', () => {
    const h = setup();
    h.store.getState().enter();
    h.store.getState().toggleBreakpoint(h.id('attack'));
    expect([...h.store.getState().breakpoints]).toEqual([h.id('attack')]);
    h.store.getState().setSpeed(10);
    h.store.getState().play();
    vi.advanceTimersByTime(1000);
    const state = h.store.getState();
    expect(state.playing).toBe(false);
    expect(h.deps.focus).toHaveBeenCalledWith(h.id('attack'));
    expect(h.deps.select).toHaveBeenCalledWith({ kind: 'node', nodeId: h.id('attack') });
    // attack was entered in the last recorded tick
    const last = state.history[state.history.length - 1];
    expect(last.log.some((e) => e.kind === 'enter' && e.nodeId === h.id('attack'))).toBe(true);

    h.store.getState().toggleBreakpoint(h.id('attack'));
    expect(h.store.getState().breakpoints.size).toBe(0);
  });

  it('pauses on a manual action and resolves it', () => {
    const h = setup({
      type: 'Sequence',
      childNodes: [{ type: 'Ask', label: 'ask' }, { type: 'Succeed' }],
    });
    h.store.getState().enter();
    h.store.getState().setSpeed(10);
    h.store.getState().play();
    vi.advanceTimersByTime(500);
    let state = h.store.getState();
    expect(state.playing).toBe(false);
    const pending = state.history[state.history.length - 1].pendingManual;
    expect(pending).toBe(h.id('ask'));
    expect(h.deps.focus).toHaveBeenCalledWith(h.id('ask'));

    // stepping while a manual result is pending does nothing
    const before = state.history.length;
    h.store.getState().step();
    expect(h.store.getState().history).toHaveLength(before);

    h.store.getState().resolveManual('success');
    state = h.store.getState();
    expect(state.history[state.history.length - 1].pendingManual).toBeUndefined();
    h.store.getState().step();
    state = h.store.getState();
    expect(state.history[state.history.length - 1].finished).toBe('success');
  });

  it('replays past ticks and jumps back to live when stepping', () => {
    const h = setup();
    h.store.getState().enter();
    h.store.getState().step();
    h.store.getState().step();
    h.store.getState().seek(1);
    expect(h.store.getState().viewIndex).toBe(1);
    h.store.getState().seek(-5);
    expect(h.store.getState().viewIndex).toBe(0);
    h.store.getState().seek(99);
    expect(h.store.getState().viewIndex).toBe(2);
    h.store.getState().seek(1);
    h.store.getState().step();
    const state = h.store.getState();
    expect(state.history).toHaveLength(4);
    expect(state.viewIndex).toBe(3);
    h.store.getState().seek(0);
    h.store.getState().backToLive();
    expect(h.store.getState().viewIndex).toBe(3);
  });

  it('steps back to undo the latest tick and steps forward again', () => {
    const h = setup();
    h.store.getState().enter();
    expect(selectCanStepBack(h.store.getState())).toBe(false);
    h.store.getState().stepBack();
    expect(h.store.getState().history).toHaveLength(1);
    for (let i = 0; i < 4; i++) h.store.getState().step();
    const forward = h.store.getState().history;
    expect(forward[forward.length - 1].finished).toBe('success');
    expect(forward[forward.length - 1].blackboard).toEqual({ Ammo: 1 });

    h.store.getState().stepBack();
    h.store.getState().stepBack();
    let state = h.store.getState();
    expect(state.history.map((r) => r.tick)).toEqual([0, 1]);
    expect(state.viewIndex).toBe(1);
    expect(state.history[1].statuses[h.id('wait')]).toBe('running');
    expect(selectCanStepBack(state)).toBe(true);

    h.store.getState().step();
    h.store.getState().step();
    state = h.store.getState();
    expect(state.history).toEqual(forward);
    expect(state.history[state.history.length - 1].blackboard).toEqual({ Ammo: 1 });
  });

  it('stepping back pauses playback and keeps live blackboard edits of earlier ticks', () => {
    const h = setup();
    h.store.getState().enter();
    h.store.getState().step();
    h.store.getState().setBlackboardValue('Ammo', 5);
    h.store.getState().step();
    h.store.getState().play();
    h.store.getState().stepBack();
    const state = h.store.getState();
    expect(state.playing).toBe(false);
    expect(state.history.map((r) => r.tick)).toEqual([0, 1]);
    expect(state.history[1].blackboard).toEqual({ Ammo: 5 });
  });

  it('steps back into a pending manual action', () => {
    const h = setup({
      type: 'Sequence',
      childNodes: [{ type: 'Ask', label: 'ask' }, { type: 'Succeed' }],
    });
    h.store.getState().enter();
    h.store.getState().step();
    h.store.getState().resolveManual('success');
    h.store.getState().step();
    expect(h.store.getState().history[2].finished).toBe('success');
    vi.mocked(h.deps.focus).mockClear();
    h.store.getState().stepBack();
    const state = h.store.getState();
    expect(state.history[1].pendingManual).toBeUndefined();
    h.store.getState().step();
    expect(h.store.getState().history[2].finished).toBe('success');
    h.store.getState().stepBack();
    h.store.getState().stepBack();
    expect(h.store.getState().history).toHaveLength(1);
    h.store.getState().step();
    expect(h.store.getState().history[1].pendingManual).toBe(h.id('ask'));
    expect(h.deps.focus).toHaveBeenCalledWith(h.id('ask'));
  });

  it('seeking pauses playback', () => {
    const h = setup();
    h.store.getState().enter();
    h.store.getState().step();
    h.store.getState().play();
    h.store.getState().seek(0);
    expect(h.store.getState().playing).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(h.store.getState().history).toHaveLength(2);
  });

  it('applies blackboard edits to the live run and remembers them as start values', () => {
    const h = setup();
    h.store.getState().enter();
    h.store.getState().step();
    h.store.getState().step();
    h.store.getState().step();
    expect(h.store.getState().history[3].blackboard.Ammo).toBe(1);
    h.store.getState().setBlackboardValue('Ammo', 2);
    let state = h.store.getState();
    expect(state.history[3].blackboard.Ammo).toBe(2);
    expect(entriesToRecord(state.blackboard).Ammo).toBe(2);

    h.store.getState().setBlackboardValue('Flag', true);
    expect(h.store.getState().history[3].blackboard.Flag).toBe(true);

    h.store.getState().updateBlackboardEntry(1, { key: 'Renamed' });
    state = h.store.getState();
    expect(state.history[3].blackboard.Flag).toBeUndefined();
    expect(state.history[3].blackboard.Renamed).toBe(true);

    h.store.getState().removeBlackboardEntry(1);
    expect(h.store.getState().history[3].blackboard.Renamed).toBeUndefined();

    h.store.getState().addBlackboardEntry();
    expect(h.store.getState().blackboard.map((e) => e.key)).toEqual(['Ammo', 'Key']);
    h.store.getState().addBlackboardEntry();
    expect(h.store.getState().blackboard.map((e) => e.key)).toEqual(['Ammo', 'Key', 'Key2']);

    // a reset starts from the edited start values
    h.store.getState().reset();
    expect(h.store.getState().history[0].blackboard.Ammo).toBe(2);
  });

  it('writes edited values even when the start value is unchanged', () => {
    const h = setup({ type: 'Attack', label: 'attack' });
    h.store.getState().enter();
    h.store.getState().step();
    expect(h.store.getState().history[1].blackboard.Ammo).toBe(1);
    // finished run; the live blackboard (1) differs from the start value (2)
    h.store.getState().setBlackboardValue('Ammo', 2);
    expect(h.store.getState().history[1].blackboard.Ammo).toBe(2);
  });

  it('does not touch the live run when a past tick is viewed', () => {
    const h = setup();
    h.store.getState().enter();
    h.store.getState().step();
    h.store.getState().seek(0);
    h.store.getState().setBlackboardValue('Ammo', 9);
    expect(h.store.getState().history[1].blackboard.Ammo).toBe(2);
    expect(entriesToRecord(h.store.getState().blackboard).Ammo).toBe(9);
  });

  it('overrides node properties and restarts the run', () => {
    const h = setup();
    h.store.getState().enter();
    h.store.getState().step();
    h.store.getState().setOverride(h.id('wait'), 'Duration', 0);
    expect(h.store.getState().history).toHaveLength(1);
    h.store.getState().step();
    expect(h.store.getState().history[1].statuses[h.id('wait')]).toBe('success');
    expect(h.store.getState().overrides).toEqual({ [h.id('wait')]: { Duration: 0 } });

    h.store.getState().setOverride(h.id('wait'), 'Duration', undefined);
    expect(h.store.getState().overrides).toEqual({});
    h.store.getState().setOverride(h.id('wait'), 'Duration', 5);
    h.store.getState().clearOverrides(h.id('wait'));
    expect(h.store.getState().overrides).toEqual({});
    h.store.getState().setOverride(h.id('wait'), 'Duration', 5);
    h.store.getState().clearOverrides();
    expect(h.store.getState().overrides).toEqual({});
  });

  it('starts from the declared blackboard keys when there is no scenario', () => {
    const declaredProject = compileProject({
      ...PROJECT_FILE,
      blackboard: [
        { name: 'Ammo', type: 'number', default: 3 },
        { name: 'Enemy', type: 'bool' },
      ],
    });
    const h = setup(SIMPLE, { getProject: () => declaredProject }, []);
    h.store.getState().enter();
    expect(entriesToRecord(h.store.getState().blackboard)).toEqual({ Ammo: 3, Enemy: false });

    // A scenario still wins over the declarations.
    const withScenario = setup(SIMPLE, { getProject: () => declaredProject });
    withScenario.store.getState().enter();
    expect(entriesToRecord(withScenario.store.getState().blackboard)).toEqual({ Ammo: 2 });
  });

  it('loads scenarios', () => {
    const h = setup();
    h.store.getState().enter();
    h.store.getState().step();
    h.store.getState().loadScenario('Empty');
    const state = h.store.getState();
    expect(state.selectedScenario).toBe('Empty');
    expect(entriesToRecord(state.blackboard)).toEqual({ Ammo: 0 });
    expect(state.history).toHaveLength(1);
    expect(state.history[0].blackboard.Ammo).toBe(0);

    h.store.getState().loadScenario('Nope');
    expect(h.notifications.at(-1)).toContain("Unknown scenario 'Nope'");
  });

  it('saves a scenario into the project file', async () => {
    const h = setup();
    h.store.getState().enter();
    h.store.getState().setBlackboardValue('Ammo', 7);
    await expect(h.store.getState().saveScenario('  Mine ')).resolves.toBe(true);
    expect(h.saved).toHaveLength(1);
    expect(h.saved[0].path).toBe('/p/owl-bt.json');
    expect(h.saved[0].baseHash).toBe('h1');
    expect((h.saved[0].content.scenarios as ScenarioJson[]).map((s) => s.name)).toEqual([
      'Armed',
      'Empty',
      'Mine',
    ]);
    expect((h.saved[0].content.scenarios as ScenarioJson[])[2].blackboard).toEqual({ Ammo: 7 });
    expect(h.store.getState().selectedScenario).toBe('Mine');
    expect(h.notifications.at(-1)).toBe("success: Scenario 'Mine' saved");
  });

  it('overwrites a scenario of the same name keeping its description', async () => {
    const h = setup(SIMPLE, {
      fetchMeta: vi.fn(async () => ({
        path: '/p/owl-bt.json',
        hash: 'h1',
        content: JSON.stringify({
          scenarios: [{ name: 'Armed', description: 'keep me', blackboard: { Ammo: 2 } }],
        }),
      })),
    });
    h.store.getState().enter();
    h.store.getState().setBlackboardValue('Ammo', 3);
    await h.store.getState().saveScenario('Armed');
    expect(h.saved[0].content.scenarios).toEqual([
      { name: 'Armed', description: 'keep me', blackboard: { Ammo: 3 } },
    ]);
  });

  it('reports a conflict (409) instead of overwriting', async () => {
    const h = setup(SIMPLE, {
      saveProject: vi.fn(async () => {
        throw new ApiError(409, 'Project file changed on disk');
      }),
    });
    h.store.getState().enter();
    await expect(h.store.getState().saveScenario('Mine')).resolves.toBe(false);
    expect(h.notifications.at(-1)).toContain('changed on disk');
    expect(h.store.getState().selectedScenario).toBe('Armed');
  });

  it('reports other save errors and empty names', async () => {
    const h = setup(SIMPLE, {
      fetchMeta: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    h.store.getState().enter();
    await expect(h.store.getState().saveScenario('x')).resolves.toBe(false);
    expect(h.notifications.at(-1)).toBe('error: Failed to save scenario: boom');
    await expect(h.store.getState().saveScenario('   ')).resolves.toBe(false);
    expect(h.notifications.at(-1)).toContain('must not be empty');
  });

  it('deletes a scenario and removes the field when none is left', async () => {
    const h = setup(SIMPLE, {
      fetchMeta: vi.fn(async () => ({
        path: '/p/owl-bt.json',
        hash: 'h1',
        content: JSON.stringify({ nodes: [], scenarios: [{ name: 'Armed', blackboard: {} }] }),
      })),
    });
    h.store.getState().enter();
    await expect(h.store.getState().deleteScenario('Armed')).resolves.toBe(true);
    expect(h.saved[0].content).toEqual({ nodes: [] });
    expect(h.store.getState().selectedScenario).toBeUndefined();
  });
  describe('looped runs', () => {
    const ONE: TreeNodeJson = { type: 'Succeed', label: 's' };

    beforeEach(() => {
      window.localStorage.clear();
    });

    it('starts with the stored loops value and persists changes', () => {
      window.localStorage.setItem('owlbt.runLoops', '3');
      const h = setup(ONE);
      expect(h.store.getState().loops).toBe(3);
      h.store.getState().setLoops(-2.5);
      expect(h.store.getState().loops).toBe(0);
      h.store.getState().setLoops(Number.NaN);
      expect(h.store.getState().loops).toBe(1);
      expect(window.localStorage.getItem('owlbt.runLoops')).toBe('1');
    });

    it('runs the configured number of passes', () => {
      const h = setup(ONE);
      h.store.getState().setLoops(3);
      h.store.getState().enter();
      for (let i = 0; i < 5; i++) h.store.getState().step();
      const history = h.store.getState().history;
      expect(history).toHaveLength(4);
      expect(history[3].finished).toBe('success');
      expect(history.map((t) => t.pass)).toEqual([1, 1, 2, 3]);
    });

    it('applies a change at tick 0 and to the live run', () => {
      const h = setup(ONE);
      h.store.getState().enter();
      h.store.getState().setLoops(2);
      expect(h.store.getState().history[0].passes).toBe(2);
      h.store.getState().step();
      h.store.getState().setLoops(5);
      expect(h.store.getState().history[1].passes).toBe(5);
      h.store.getState().setLoops(1);
      expect(h.store.getState().history[1].finished).toBe('success');
      h.store.getState().step();
      expect(h.store.getState().history).toHaveLength(2);
    });

    it('lowering below the current pass makes it the last one', () => {
      const h = setup({ type: 'Wait', label: 'w' });
      h.store.getState().setLoops(5);
      h.store.getState().enter();
      for (let i = 0; i < 3; i++) h.store.getState().step();
      expect(h.store.getState().history[3].pass).toBe(2);
      h.store.getState().setLoops(1);
      h.store.getState().step();
      const last = h.store.getState().history[4];
      expect(last.pass).toBe(2);
      expect(last.finished).toBe('success');
    });

    it('plays an endless run until paused and caps the history', () => {
      const h = setup(ONE);
      h.store.getState().setLoops(0);
      h.store.getState().enter();
      h.store.getState().setSpeed(10);
      h.store.getState().play();
      vi.advanceTimersByTime(100 * (MAX_HISTORY + 20));
      const state = h.store.getState();
      expect(state.playing).toBe(true);
      expect(state.history).toHaveLength(MAX_HISTORY);
      expect(state.dropped).toBeGreaterThan(0);
      const last = state.history[state.history.length - 1];
      expect(state.history[0].tick).toBe(state.dropped);
      expect(last.tick).toBe(state.dropped + MAX_HISTORY - 1);
      expect(state.viewIndex).toBe(MAX_HISTORY - 1);
      expect(last.finished).toBeUndefined();

      state.pause();
      expect(h.store.getState().playing).toBe(false);
      h.store.getState().reset();
      expect(h.store.getState().dropped).toBe(0);
      expect(h.store.getState().history).toHaveLength(1);
    });
  });
});
