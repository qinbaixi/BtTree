import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

export type AlertType = 'error' | 'warning' | 'info' | 'success';

export interface Alert {
  id: number;
  type: AlertType;
  message: string;
  /** Dismissed automatically after this many milliseconds. */
  autoHideMs?: number;
}

export interface AlertOptions {
  autoHideMs?: number;
}

export interface AlertState {
  alerts: Alert[];
  /** Adds an alert and returns its id. An identical non-auto-hiding alert is not added twice. */
  push(type: AlertType, message: string, options?: AlertOptions): number;
  dismiss(id: number): void;
  clear(): void;
}

/** Success messages such as 'Done' disappear on their own. */
export const SUCCESS_AUTO_HIDE_MS = 1000;
/** Upper bound on concurrent alerts to avoid unbounded growth during rapid error bursts. */
export const MAX_ALERTS = 20;

let nextId = 1;

export function createAlertStore() {
  return createStore<AlertState>()((set, get) => {
    const timers = new Map<number, ReturnType<typeof setTimeout>>();

    const clearTimer = (id: number): void => {
      const handle = timers.get(id);
      if (handle !== undefined) {
        clearTimeout(handle);
        timers.delete(id);
      }
    };

    const dismiss = (id: number): void => {
      clearTimer(id);
      set((state) => ({ alerts: state.alerts.filter((alert) => alert.id !== id) }));
    };

    return {
      alerts: [],

      push(type, message, options = {}) {
        const existing = get().alerts.find(
          (alert) => alert.type === type && alert.message === message && !alert.autoHideMs,
        );
        if (existing && options.autoHideMs === undefined) {
          return existing.id;
        }

        const autoHideMs =
          options.autoHideMs ?? (type === 'success' ? SUCCESS_AUTO_HIDE_MS : undefined);
        const alert: Alert = { id: nextId++, type, message };
        if (autoHideMs !== undefined) {
          alert.autoHideMs = autoHideMs;
          const handle = setTimeout(() => {
            timers.delete(alert.id);
            dismiss(alert.id);
          }, autoHideMs);
          timers.set(alert.id, handle);
        }
        set((state) => {
          const next = [...state.alerts, alert];
          if (next.length > MAX_ALERTS) {
            for (const dropped of next.slice(0, next.length - MAX_ALERTS)) {
              clearTimer(dropped.id);
            }
            return { alerts: next.slice(-MAX_ALERTS) };
          }
          return { alerts: next };
        });
        return alert.id;
      },

      dismiss,

      clear() {
        for (const handle of timers.values()) {
          clearTimeout(handle);
        }
        timers.clear();
        set({ alerts: [] });
      },
    };
  });
}

export type AlertStore = ReturnType<typeof createAlertStore>;

/** Application-wide alert store. */
export const alertStore: AlertStore = createAlertStore();

/** Convenience wrappers over the application-wide store. */
export const alerts = {
  error: (message: string, options?: AlertOptions) =>
    alertStore.getState().push('error', message, options),
  warning: (message: string, options?: AlertOptions) =>
    alertStore.getState().push('warning', message, options),
  info: (message: string, options?: AlertOptions) =>
    alertStore.getState().push('info', message, options),
  success: (message: string, options?: AlertOptions) =>
    alertStore.getState().push('success', message, options),
};

export function useAlerts(): Alert[] {
  return useStore(alertStore, (state) => state.alerts);
}
