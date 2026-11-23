import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAlertStore, MAX_ALERTS, SUCCESS_AUTO_HIDE_MS } from './alertStore';

describe('alertStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('pushes and dismisses alerts', () => {
    const store = createAlertStore();
    const id = store.getState().push('error', 'boom');
    expect(store.getState().alerts).toEqual([{ id, type: 'error', message: 'boom' }]);
    store.getState().dismiss(id);
    expect(store.getState().alerts).toEqual([]);
  });

  it('auto-hides success alerts after 1000ms by default', () => {
    const store = createAlertStore();
    store.getState().push('success', 'Done');
    vi.advanceTimersByTime(SUCCESS_AUTO_HIDE_MS - 1);
    expect(store.getState().alerts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(store.getState().alerts).toHaveLength(0);
  });

  it('auto-hides with an explicit delay', () => {
    const store = createAlertStore();
    store.getState().push('info', 'later', { autoHideMs: 50 });
    vi.advanceTimersByTime(50);
    expect(store.getState().alerts).toHaveLength(0);
  });

  it('does not add an identical sticky alert twice', () => {
    const store = createAlertStore();
    const first = store.getState().push('warning', 'same');
    const second = store.getState().push('warning', 'same');
    expect(second).toBe(first);
    expect(store.getState().alerts).toHaveLength(1);
  });

  it('keeps alerts of different types with the same message', () => {
    const store = createAlertStore();
    store.getState().push('warning', 'same');
    store.getState().push('error', 'same');
    expect(store.getState().alerts).toHaveLength(2);
  });

  it('clears all alerts', () => {
    const store = createAlertStore();
    store.getState().push('error', 'a');
    store.getState().push('error', 'b');
    store.getState().clear();
    expect(store.getState().alerts).toEqual([]);
  });

  it('cancels pending auto-hide timers on dismiss/clear and caps concurrent alerts', () => {
    const store = createAlertStore();
    const id = store.getState().push('success', 'one', { autoHideMs: 500 });
    expect(vi.getTimerCount()).toBe(1);
    store.getState().dismiss(id);
    expect(vi.getTimerCount()).toBe(0);

    for (let i = 0; i < MAX_ALERTS + 5; i++) {
      store.getState().push('info', `msg-${i}`, { autoHideMs: 500 });
    }
    expect(store.getState().alerts).toHaveLength(MAX_ALERTS);
    expect(vi.getTimerCount()).toBe(MAX_ALERTS);
    store.getState().clear();
    expect(vi.getTimerCount()).toBe(0);
  });
});
