import { io } from 'socket.io-client';
import {
  parseAndCompileProject,
  type CompiledProject,
  type ProjectReloadPayload,
  type ScenarioJson,
} from '@owlbt/shared';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { fetchProject } from '../lib/api';
import { alertStore, alerts } from './alertStore';
import { t } from '../i18n';

export const PROJECT_WATCH_NAMESPACE = '/prj-watch';
export const PROJECT_RELOAD_EVENT = 'prj-reload';

/** The part of a socket.io client used by the store (injectable for tests). */
export interface ProjectSocket {
  on(event: string, listener: (payload: ProjectReloadPayload) => void): unknown;
  disconnect(): unknown;
}

export type SocketFactory = (treePath: string) => ProjectSocket;

export interface ProjectStoreDeps {
  fetchProject: (treePath: string) => Promise<string>;
  createSocket: SocketFactory;
}

export const defaultSocketFactory: SocketFactory = (treePath) => {
  const socket = io(PROJECT_WATCH_NAMESPACE, { query: { treePath } });
  return {
    on: (event, listener) => socket.on(event, listener),
    disconnect: () => socket.disconnect(),
  };
};

export interface ProjectState {
  treePath?: string;
  project?: CompiledProject;
  /** Run mode scenarios of the project file (empty without any). */
  scenarios: ScenarioJson[];
  /** Last load/parse error. Cleared on the next successful project update. */
  error?: string;
  /** Increments on every successful project update. */
  version: number;
  load(treePath: string): Promise<void>;
  /** Parses and compiles project text. On error the previous project is kept. */
  applyContent(text: string): boolean;
  /** Subscribes to live reloads of the project of the given tree. */
  connect(treePath: string): void;
  disconnect(): void;
}

const defaultDeps: ProjectStoreDeps = {
  fetchProject,
  createSocket: defaultSocketFactory,
};

/** Valid scenarios of the project text (entries without a name or blackboard object are skipped). */
export function parseScenarios(text: string): ScenarioJson[] {
  try {
    const parsed = JSON.parse(text) as { scenarios?: unknown };
    if (!Array.isArray(parsed.scenarios)) {
      return [];
    }
    return parsed.scenarios.filter(
      (entry): entry is ScenarioJson =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as ScenarioJson).name === 'string' &&
        typeof (entry as ScenarioJson).blackboard === 'object' &&
        (entry as ScenarioJson).blackboard !== null &&
        !Array.isArray((entry as ScenarioJson).blackboard),
    );
  } catch {
    return [];
  }
}

export function createProjectStore(deps: Partial<ProjectStoreDeps> = {}) {
  const { fetchProject: fetchText, createSocket } = { ...defaultDeps, ...deps };

  return createStore<ProjectState>()((set, get) => {
    let socket: ProjectSocket | undefined;
    let loadToken = 0;
    /** Id of the alert shown for the current project error, so it can be dismissed once the project loads. */
    let errorAlertId: number | undefined;

    const dismissErrorAlert = (): void => {
      if (errorAlertId !== undefined) {
        alertStore.getState().dismiss(errorAlertId);
        errorAlertId = undefined;
      }
    };

    const fail = (message: string): void => {
      dismissErrorAlert();
      set({ error: message });
      errorAlertId = alerts.error(message);
    };

    const applyContent = (text: string): boolean => {
      const result = parseAndCompileProject(text);
      if (!result.project) {
        fail(result.error ?? t('Failed to compile project'));
        return false;
      }
      dismissErrorAlert();
      set((state) => ({
        project: result.project,
        scenarios: parseScenarios(text),
        error: undefined,
        version: state.version + 1,
      }));
      return true;
    };

    return {
      version: 0,
      scenarios: [],

      async load(treePath) {
        const token = ++loadToken;
        set({ treePath, error: undefined });
        let text: string;
        try {
          text = await fetchText(treePath);
        } catch (err) {
          if (token === loadToken) {
            fail(err instanceof Error ? err.message : String(err));
          }
          return;
        }
        if (token === loadToken) {
          applyContent(text);
        }
      },

      applyContent,

      connect(treePath) {
        get().disconnect();
        set({ treePath });
        const current = createSocket(treePath);
        socket = current;
        current.on(PROJECT_RELOAD_EVENT, (payload) => {
          if (socket !== current) {
            return; // stale socket after disconnect/reconnect
          }
          if ('error' in payload) {
            fail(payload.error);
            return;
          }
          applyContent(payload.content);
        });
      },

      disconnect() {
        if (socket) {
          socket.disconnect();
          socket = undefined;
        }
      },
    };
  });
}

export type ProjectStore = ReturnType<typeof createProjectStore>;

/** Application-wide project store. */
export const projectStore: ProjectStore = createProjectStore();

export function useProjectStore<T>(selector: (state: ProjectState) => T): T {
  return useStore(projectStore, selector);
}
