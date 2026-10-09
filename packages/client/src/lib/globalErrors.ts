import { alerts } from '../store/alertStore';

/**
 * Routes uncaught errors and unhandled promise rejections to the alert store.
 * Returns a function removing the listeners.
 */
export function installGlobalErrorListeners(target: Window = window): () => void {
  const onError = (event: ErrorEvent): void => {
    const message = event.error instanceof Error ? event.error.message : event.message;
    if (message) {
      alerts.error(message);
    }
  };

  const onRejection = (event: PromiseRejectionEvent): void => {
    const reason: unknown = event.reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    alerts.error(message);
  };

  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
