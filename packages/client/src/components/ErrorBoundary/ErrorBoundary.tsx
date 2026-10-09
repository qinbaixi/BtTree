import { Component, type ErrorInfo, type ReactNode } from 'react';
import { alerts } from '../../store/alertStore';
import styles from './ErrorBoundary.module.css';

export interface ErrorBoundaryProps {
  children?: ReactNode;
}

interface ErrorBoundaryState {
  error?: Error;
}

/** Top-level boundary: shows the error as an alert instead of a blank page. */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {};

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    const message = error instanceof Error ? error.message : String(error);
    alerts.error(message);
    console.error(error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }
    return (
      <div className={styles.page}>
        <div className={styles.alert} role="alert">
          <strong>Something went wrong.</strong>
          <pre className={styles.details}>{error.message}</pre>
          <a href="/">Back to home</a>
        </div>
      </div>
    );
  }
}
