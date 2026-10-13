import {
  createRun,
  normalizeLoops,
  type CompiledProject,
  type ManualResult,
  type Run,
  type RunCheckpoint,
  type ScenarioJson,
  type Selection,
  type TickResult,
  type TreeNode,
} from '@owlbt/shared';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { focusNode } from '../components/TreeCanvas/viewportStore';
import {
  ApiError,
  fetchProjectMeta,
  saveProject,
  type ProjectMeta,
  type ProjectSaveBody,
} from '../lib/api';
import { getJson, setJson } from '../lib/storage';
import { alerts } from './alertStore';
import { projectStore } from './projectStore';
import { treeStore } from './treeStore';

export const MIN_SPEED = 0.5;
export const MAX_SPEED = 10;
export const DEFAULT_SPEED = 2;
/** Ticks kept in the history; older ones are dropped (matters for endless runs). */
export const MAX_HISTORY = 5000;
export const LOOPS_STORAGE_KEY = 'owlbt.runLoops';

/** Loops value from user input or storage: integer >= 0, anything unusable becomes 1. */
export function clampLoops(value: unknown): number {
  return typeof value === 'number' ? normalizeLoops(value) : 1;
}

/** One row of the blackboard editor. Values are plain JSON values (number, string, boolean, null). */
export interface BlackboardEntry {
  key: string;
  value: unknown;
}

export type AdvanceOutcome = 'continue' | 'finished' | 'manual' | 'breakpoint' | 'idle';

export interface RunState {
  /** Run mode is on: the tree is read-only and the run panels are shown. */
  active: boolean;
  /** history[0] is the state before the first tick; the last entry is the live state. */
  history: TickResult[];
  /** Index of the history entry that is shown (below the last one = replay of a past tick). */
  viewIndex: number;
  /** Number of ticks dropped from the start of the history (see MAX_HISTORY). */
  dropped: number;
  /** Increases whenever a new run is built. */
  runId: number;
  /** Number of times the tree runs; 0 = endless. */
  loops: number;
  playing: boolean;
  /** Ticks per second while playing. */
  speed: number;
  breakpoints: ReadonlySet<string>;
  /** Property overrides by node / decorator / service id. */
  overrides: Record<string, Record<string, unknown>>;
  /** Blackboard the run starts from (edited in the panel). */
  blackboard: BlackboardEntry[];
  selectedScenario?: string;
  seed: number;

  enter(): boolean;
  exit(): void;
  /** Rebuilds the run from the current tree, project, blackboard and overrides. */
  reset(): void;
  step(): void;
  /** Undoes the latest tick: the run continues from the state before it. */
  stepBack(): void;
  play(): void;
  pause(): void;
  togglePlay(): void;
  setSpeed(speed: number): void;
  /** Sets the number of runs (0 = endless); applied to the live run, remembered in localStorage. */
  setLoops(loops: number): void;
  seek(index: number): void;
  backToLive(): void;
  resolveManual(result: ManualResult): void;
  toggleBreakpoint(nodeId: string): void;

  setOverride(id: string, prop: string, value: unknown): void;
  clearOverrides(id?: string): void;

  /** Sets the value of a key (adding it to the start blackboard if needed); applied live at the latest tick. */
  setBlackboardValue(key: string, value: unknown): void;
  addBlackboardEntry(): void;
  updateBlackboardEntry(index: number, patch: Partial<BlackboardEntry>): void;
  removeBlackboardEntry(index: number): void;

  loadScenario(name: string): void;
  saveScenario(name: string): Promise<boolean>;
  deleteScenario(name: string): Promise<boolean>;
}

export interface RunStoreDeps {
  getTree(): { root?: TreeNode; treePath?: string };
  getProject(): CompiledProject | undefined;
  getScenarios(): ScenarioJson[];
  fetchMeta(path: string): Promise<ProjectMeta>;
  saveProject(path: string, body: ProjectSaveBody): Promise<{ hash: string }>;
  focus(nodeId: string): void;
  select(selection: Selection | undefined): void;
  notify: {
    error(message: string): void;
    success(message: string): void;
    info(message: string): void;
  };
}

const defaultDeps: RunStoreDeps = {
  getTree: () => treeStore.getState(),
  getProject: () => projectStore.getState().project,
  getScenarios: () => projectStore.getState().scenarios,
  fetchMeta: fetchProjectMeta,
  saveProject,
  focus: focusNode,
  select: (selection) => treeStore.getState().select(selection),
  notify: {
    error: (message) => void alerts.error(message),
    success: (message) => void alerts.success(message),
    info: (message) => void alerts.info(message),
  },
};

export function entriesToRecord(entries: BlackboardEntry[]): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const { key, value } of entries) {
    if (key.trim() !== '') {
      record[key.trim()] = value;
    }
  }
  return record;
}

export function recordToEntries(record: Record<string, unknown>): BlackboardEntry[] {
  return Object.entries(record).map(([key, value]) => ({ key, value }));
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The latest history entry. History is never empty while a run exists. */
function lastOf(history: TickResult[]): TickResult | undefined {
  return history[history.length - 1];
}

export function createRunStore(overrides: Partial<RunStoreDeps> = {}) {
  const deps: RunStoreDeps = { ...defaultDeps, ...overrides };

  return createStore<RunState>()((set, get) => {
    let run: Run | undefined;
    /** checkpoints[i] is the run state of history[i]; trimmed together with the history. */
    let checkpoints: RunCheckpoint[] = [];
    let timer: ReturnType<typeof setInterval> | undefined;

    const stopTimer = (): void => {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    };

    const startTimer = (): void => {
      stopTimer();
      timer = setInterval(() => {
        const outcome = advance();
        if (outcome !== 'continue') {
          get().pause();
        }
      }, 1000 / get().speed);
    };

    const focusAndSelect = (nodeId: string): void => {
      deps.select({ kind: 'node', nodeId });
      deps.focus(nodeId);
    };

    /** Executes one tick and records it. Does nothing when finished or waiting for a manual result. */
    function advance(): AdvanceOutcome {
      if (!run) {
        return 'idle';
      }
      const state = get();
      const previous = lastOf(state.history);
      if (previous?.finished) {
        return 'finished';
      }
      if (run.pendingManual()) {
        return 'manual';
      }
      const result = run.tick();
      let history = [...state.history, result];
      checkpoints.push(run.checkpoint());
      let dropped = state.dropped;
      if (history.length > MAX_HISTORY) {
        const extra = history.length - MAX_HISTORY;
        history = history.slice(extra);
        checkpoints = checkpoints.slice(extra);
        dropped += extra;
      }
      set({ history, viewIndex: history.length - 1, dropped });

      const hit = result.log.find(
        (entry) => entry.kind === 'enter' && state.breakpoints.has(entry.nodeId),
      );
      if (hit) {
        focusAndSelect(hit.nodeId);
        return 'breakpoint';
      }
      if (result.pendingManual) {
        focusAndSelect(result.pendingManual);
        return 'manual';
      }
      if (result.finished) {
        return 'finished';
      }
      return 'continue';
    }

    /** Replaces the live history entry by the current run state (after live edits). */
    const refreshLive = (): void => {
      if (!run) {
        return;
      }
      const history = get().history.slice();
      if (history.length === 0) {
        return;
      }
      history[history.length - 1] = run.snapshot();
      checkpoints[checkpoints.length - 1] = run.checkpoint();
      set({ history });
    };

    const build = (): boolean => {
      stopTimer();
      const { root } = deps.getTree();
      const project = deps.getProject();
      if (!root || !project) {
        run = undefined;
        checkpoints = [];
        set({ history: [], viewIndex: 0, dropped: 0, playing: false });
        return false;
      }
      const state = get();
      run = createRun(root, project, {
        blackboard: entriesToRecord(state.blackboard),
        seed: state.seed,
        overrides: state.overrides,
        loops: state.loops,
      });
      checkpoints = [run.checkpoint()];
      set({
        history: [run.snapshot()],
        viewIndex: 0,
        dropped: 0,
        runId: state.runId + 1,
        playing: false,
      });
      return true;
    };

    /** Applies the difference between two blackboards to the live run. */
    const syncLive = (
      before: BlackboardEntry[],
      after: BlackboardEntry[],
      touched: string[],
    ): void => {
      const state = get();
      if (!run || state.viewIndex !== state.history.length - 1) {
        return;
      }
      const oldRecord = entriesToRecord(before);
      const newRecord = entriesToRecord(after);
      for (const key of Object.keys(oldRecord)) {
        if (!Object.hasOwn(newRecord, key)) {
          run.removeBlackboardKey(key);
        }
      }
      for (const [key, value] of Object.entries(newRecord)) {
        if (!Object.hasOwn(oldRecord, key) || oldRecord[key] !== value) {
          run.setBlackboardValue(key, value);
        }
      }
      // Keys the user edited are written even when the start value did not change (the live value may differ).
      for (const key of touched) {
        if (Object.hasOwn(newRecord, key)) {
          run.setBlackboardValue(key, newRecord[key]);
        }
      }
      refreshLive();
    };

    const editBlackboard = (next: BlackboardEntry[], touched: string[] = []): void => {
      const before = get().blackboard;
      set({ blackboard: next });
      syncLive(before, next, touched);
    };

    /** Reads owl-bt.json, changes the scenarios and writes it back. */
    const updateScenarios = async (
      change: (scenarios: ScenarioJson[]) => ScenarioJson[],
      success: string,
    ): Promise<boolean> => {
      const { treePath } = deps.getTree();
      if (!treePath) {
        deps.notify.error('Open a tree before editing scenarios');
        return false;
      }
      try {
        const meta = await deps.fetchMeta(treePath);
        const file = JSON.parse(meta.content) as Record<string, unknown>;
        const current = Array.isArray(file.scenarios) ? (file.scenarios as ScenarioJson[]) : [];
        const next = change(current);
        if (next.length > 0) {
          file.scenarios = next;
        } else {
          delete file.scenarios;
        }
        await deps.saveProject(meta.path, { content: file, baseHash: meta.hash });
        deps.notify.success(success);
        return true;
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          deps.notify.error(
            'The project file changed on disk. Run mode did not overwrite it; try again.',
          );
        } else {
          deps.notify.error(`Failed to save scenario: ${errorText(err)}`);
        }
        return false;
      }
    };

    return {
      active: false,
      history: [],
      viewIndex: 0,
      dropped: 0,
      runId: 0,
      loops: clampLoops(getJson<unknown>(LOOPS_STORAGE_KEY, 1)),
      playing: false,
      speed: DEFAULT_SPEED,
      breakpoints: new Set<string>(),
      overrides: {},
      blackboard: [],
      seed: 1,

      enter() {
        const { root } = deps.getTree();
        if (!root || !deps.getProject()) {
          deps.notify.error('Run mode needs a loaded tree and project');
          return false;
        }
        const state = get();
        const scenarios = deps.getScenarios();
        if (state.selectedScenario === undefined && state.blackboard.length === 0) {
          const first = scenarios[0];
          if (first) {
            set({
              selectedScenario: first.name,
              blackboard: recordToEntries(first.blackboard),
            });
          }
        }
        set({ active: true });
        build();
        return true;
      },

      exit() {
        stopTimer();
        run = undefined;
        checkpoints = [];
        set({ active: false, history: [], viewIndex: 0, dropped: 0, playing: false });
      },

      reset() {
        if (get().active) {
          build();
        }
      },

      step() {
        const state = get();
        if (!state.active || !run) {
          return;
        }
        if (state.viewIndex < state.history.length - 1) {
          set({ viewIndex: state.history.length - 1 });
        }
        get().pause();
        advance();
      },

      stepBack() {
        const state = get();
        if (!state.active || !run || state.history.length < 2) {
          return;
        }
        get().pause();
        const history = state.history.slice(0, -1);
        checkpoints = checkpoints.slice(0, -1);
        run.restore(checkpoints[checkpoints.length - 1]);
        // Loops changed after the restored tick still apply.
        run.setLoops(state.loops);
        history[history.length - 1] = run.snapshot();
        checkpoints[checkpoints.length - 1] = run.checkpoint();
        set({ history, viewIndex: history.length - 1 });
        const pending = run.pendingManual();
        if (pending) {
          focusAndSelect(pending);
        }
      },

      play() {
        const state = get();
        if (!state.active || !run) {
          return;
        }
        if (lastOf(state.history)?.finished) {
          build();
        }
        if (run.pendingManual()) {
          return;
        }
        set({ playing: true, viewIndex: get().history.length - 1 });
        startTimer();
      },

      pause() {
        stopTimer();
        if (get().playing) {
          set({ playing: false });
        }
      },

      togglePlay() {
        if (get().playing) {
          get().pause();
        } else {
          get().play();
        }
      },

      setSpeed(speed) {
        const clamped = Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed));
        set({ speed: clamped });
        if (get().playing) {
          startTimer();
        }
      },

      setLoops(value) {
        const loops = clampLoops(value);
        setJson(LOOPS_STORAGE_KEY, loops);
        set({ loops });
        if (run) {
          run.setLoops(loops);
          refreshLive();
        }
      },

      seek(index) {
        const { history } = get();
        get().pause();
        set({
          viewIndex: Math.min(Math.max(0, Math.round(index)), Math.max(0, history.length - 1)),
        });
      },

      backToLive() {
        set({ viewIndex: Math.max(0, get().history.length - 1) });
      },

      resolveManual(result) {
        if (!run) {
          return;
        }
        const id = run.pendingManual();
        if (!id) {
          return;
        }
        run.resolveManual(id, result);
        refreshLive();
        const next = run.pendingManual();
        if (next) {
          focusAndSelect(next);
        }
      },

      toggleBreakpoint(nodeId) {
        const next = new Set(get().breakpoints);
        if (next.has(nodeId)) {
          next.delete(nodeId);
        } else {
          next.add(nodeId);
        }
        set({ breakpoints: next });
      },

      setOverride(id, prop, value) {
        const all = { ...get().overrides };
        const own = { ...all[id] };
        if (value === undefined) {
          delete own[prop];
        } else {
          own[prop] = value;
        }
        if (Object.keys(own).length === 0) {
          delete all[id];
        } else {
          all[id] = own;
        }
        set({ overrides: all });
        get().reset();
      },

      clearOverrides(id) {
        if (id === undefined) {
          set({ overrides: {} });
        } else {
          const all = { ...get().overrides };
          delete all[id];
          set({ overrides: all });
        }
        get().reset();
      },

      setBlackboardValue(key, value) {
        const { blackboard } = get();
        const index = blackboard.findIndex((entry) => entry.key === key);
        editBlackboard(
          index < 0
            ? [...blackboard, { key, value }]
            : blackboard.map((entry, i) => (i === index ? { ...entry, value } : entry)),
          [key],
        );
      },

      addBlackboardEntry() {
        const { blackboard } = get();
        const taken = new Set(blackboard.map((entry) => entry.key));
        let key = 'Key';
        for (let i = 2; taken.has(key); i++) {
          key = `Key${i}`;
        }
        editBlackboard([...blackboard, { key, value: 0 }]);
      },

      updateBlackboardEntry(index, patch) {
        const { blackboard } = get();
        if (index < 0 || index >= blackboard.length) {
          return;
        }
        editBlackboard(
          blackboard.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)),
        );
      },

      removeBlackboardEntry(index) {
        const { blackboard } = get();
        editBlackboard(blackboard.filter((_, i) => i !== index));
      },

      loadScenario(name) {
        const scenario = deps.getScenarios().find((entry) => entry.name === name);
        if (!scenario) {
          deps.notify.error(`Unknown scenario '${name}'`);
          return;
        }
        set({ selectedScenario: name, blackboard: recordToEntries(scenario.blackboard) });
        get().reset();
      },

      async saveScenario(name) {
        const trimmed = name.trim();
        if (trimmed === '') {
          deps.notify.error('Scenario name must not be empty');
          return false;
        }
        const blackboard = entriesToRecord(get().blackboard);
        const ok = await updateScenarios((scenarios) => {
          const entry: ScenarioJson = { name: trimmed, blackboard };
          const index = scenarios.findIndex((s) => s.name === trimmed);
          if (index < 0) {
            return [...scenarios, entry];
          }
          const copy = scenarios.slice();
          copy[index] = { ...scenarios[index], blackboard };
          return copy;
        }, `Scenario '${trimmed}' saved`);
        if (ok) {
          set({ selectedScenario: trimmed });
        }
        return ok;
      },

      async deleteScenario(name) {
        const ok = await updateScenarios(
          (scenarios) => scenarios.filter((s) => s.name !== name),
          `Scenario '${name}' deleted`,
        );
        if (ok && get().selectedScenario === name) {
          set({ selectedScenario: undefined });
        }
        return ok;
      },
    };
  });
}

export type RunStore = ReturnType<typeof createRunStore>;

/** Application-wide run store. */
export const runStore: RunStore = createRunStore();

export function useRunStore<T>(selector: (state: RunState) => T): T {
  return useStore(runStore, selector);
}

/** The history entry that is currently shown (undefined outside run mode). */
export function selectViewed(state: RunState): TickResult | undefined {
  return state.active ? state.history[state.viewIndex] : undefined;
}

/** True when the latest tick can be undone. */
export function selectCanStepBack(state: RunState): boolean {
  return state.active && state.history.length > 1;
}

export function selectIsLive(state: RunState): boolean {
  return state.viewIndex >= state.history.length - 1;
}

/** True while a run is active and the tree must not be edited. */
export function isRunActive(): boolean {
  return runStore.getState().active;
}
