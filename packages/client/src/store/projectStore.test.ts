import type { ProjectReloadPayload } from '@owlbt/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PROJECT_JSON } from '../test/fixtures';
import { alertStore } from './alertStore';
import {
  createProjectStore,
  PROJECT_RELOAD_EVENT,
  type ProjectSocket,
} from './projectStore';

type Listener = (payload: ProjectReloadPayload) => void;

/** Fake socket that lets tests emit server events. */
function createFakeSocket() {
  const listeners = new Map<string, Listener>();
  const socket: ProjectSocket & { emit(event: string, payload: ProjectReloadPayload): void } = {
    on: vi.fn((event: string, listener: Listener) => {
      listeners.set(event, listener);
    }),
    disconnect: vi.fn(),
    emit(event, payload) {
      listeners.get(event)?.(payload);
    },
  };
  return socket;
}

describe('projectStore', () => {
  beforeEach(() => {
    alertStore.getState().clear();
  });

  it('loads and compiles the project', async () => {
    const store = createProjectStore({
      fetchProject: vi.fn(async () => PROJECT_JSON),
      createSocket: vi.fn(),
    });
    await store.getState().load('/trees/a.json');

    const state = store.getState();
    expect(state.treePath).toBe('/trees/a.json');
    expect(state.project?.nodes.Wait).toBeDefined();
    expect(state.version).toBe(1);
    expect(state.error).toBeUndefined();
  });

  it('keeps the previous project and reports an alert when content is invalid', () => {
    const store = createProjectStore({ fetchProject: vi.fn(), createSocket: vi.fn() });
    expect(store.getState().applyContent(PROJECT_JSON)).toBe(true);
    const previous = store.getState().project;

    expect(store.getState().applyContent('{broken')).toBe(false);

    expect(store.getState().project).toBe(previous);
    expect(store.getState().version).toBe(1);
    expect(store.getState().error).toBeTruthy();
    expect(alertStore.getState().alerts.map((a) => a.type)).toEqual(['error']);
  });

  it('records load failures', async () => {
    const store = createProjectStore({
      fetchProject: vi.fn(async () => {
        throw new Error('No project found');
      }),
      createSocket: vi.fn(),
    });
    await store.getState().load('/trees/a.json');

    expect(store.getState().project).toBeUndefined();
    expect(store.getState().error).toBe('No project found');
    expect(alertStore.getState().alerts[0]?.message).toBe('No project found');
  });

  it('connects to the watch socket and applies reloads', () => {
    const socket = createFakeSocket();
    const createSocket = vi.fn(() => socket);
    const store = createProjectStore({ fetchProject: vi.fn(), createSocket });

    store.getState().connect('/trees/a.json');
    expect(createSocket).toHaveBeenCalledWith('/trees/a.json');

    socket.emit(PROJECT_RELOAD_EVENT, { content: PROJECT_JSON });
    expect(store.getState().project?.decorators.Inverter).toBeDefined();
    expect(store.getState().version).toBe(1);

    socket.emit(PROJECT_RELOAD_EVENT, { content: PROJECT_JSON });
    expect(store.getState().version).toBe(2);
  });

  it('reports reload errors sent by the server as alerts', () => {
    const socket = createFakeSocket();
    const store = createProjectStore({
      fetchProject: vi.fn(),
      createSocket: () => socket,
    });
    store.getState().connect('/trees/a.json');

    socket.emit(PROJECT_RELOAD_EVENT, { error: 'Project file is gone' });

    expect(alertStore.getState().alerts.map((a) => a.message)).toEqual(['Project file is gone']);
    expect(store.getState().project).toBeUndefined();
  });

  it('disconnects and ignores events from the previous socket', () => {
    const first = createFakeSocket();
    const second = createFakeSocket();
    const sockets = [first, second];
    const store = createProjectStore({
      fetchProject: vi.fn(),
      createSocket: () => sockets.shift() as ProjectSocket,
    });

    store.getState().connect('/trees/a.json');
    store.getState().connect('/trees/b.json');
    expect(first.disconnect).toHaveBeenCalledTimes(1);

    first.emit(PROJECT_RELOAD_EVENT, { content: PROJECT_JSON });
    expect(store.getState().version).toBe(0);

    store.getState().disconnect();
    expect(second.disconnect).toHaveBeenCalledTimes(1);
  });
  it('dismisses the project error alert after a successful reload', () => {
    const store = createProjectStore({ fetchProject: vi.fn(), createSocket: vi.fn() });
    store.getState().applyContent('{broken');
    expect(alertStore.getState().alerts).toHaveLength(1);

    expect(store.getState().applyContent(PROJECT_JSON)).toBe(true);

    expect(alertStore.getState().alerts).toHaveLength(0);
    expect(store.getState().error).toBeUndefined();
  });

  it('replaces the previous error alert instead of stacking them', () => {
    const store = createProjectStore({ fetchProject: vi.fn(), createSocket: vi.fn() });
    store.getState().applyContent('{broken');
    store.getState().applyContent('[]');

    expect(alertStore.getState().alerts.map((a) => a.type)).toEqual(['error']);
  });

  it('clears a server-reported reload error once the project parses again', () => {
    const socket = createFakeSocket();
    const store = createProjectStore({ fetchProject: vi.fn(), createSocket: () => socket });
    store.getState().connect('/trees/a.json');

    socket.emit(PROJECT_RELOAD_EVENT, { error: 'Project file is gone' });
    expect(alertStore.getState().alerts).toHaveLength(1);

    socket.emit(PROJECT_RELOAD_EVENT, { content: PROJECT_JSON });
    expect(alertStore.getState().alerts).toHaveLength(0);
    expect(store.getState().error).toBeUndefined();
  });

  it('clears the load error alert when the project loads on retry', async () => {
    const fetchProject = vi
      .fn()
      .mockRejectedValueOnce(new Error('No project found'))
      .mockResolvedValueOnce(PROJECT_JSON);
    const store = createProjectStore({ fetchProject, createSocket: vi.fn() });

    await store.getState().load('/trees/a.json');
    expect(alertStore.getState().alerts).toHaveLength(1);

    await store.getState().load('/trees/a.json');
    expect(alertStore.getState().alerts).toHaveLength(0);
  });

  it('leaves unrelated alerts alone', () => {
    const store = createProjectStore({ fetchProject: vi.fn(), createSocket: vi.fn() });
    alertStore.getState().push('info', 'Saved');
    store.getState().applyContent('{broken');
    store.getState().applyContent(PROJECT_JSON);

    expect(alertStore.getState().alerts.map((a) => a.message)).toEqual(['Saved']);
  });
});
