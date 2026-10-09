import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAlertStore, SUCCESS_AUTO_HIDE_MS } from './alertStore';

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
});
