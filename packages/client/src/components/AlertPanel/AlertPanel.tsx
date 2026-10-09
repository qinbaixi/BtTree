import { alertStore, useAlerts } from '../../store/alertStore';
import styles from './AlertPanel.module.css';

export default function AlertPanel() {
  const alerts = useAlerts();
  if (alerts.length === 0) {
    return null;
  }

  return (
    <div className={styles.panel} role="status" aria-live="polite">
      {alerts.map((alert) => (
        <div key={alert.id} className={`${styles.alert} ${styles[alert.type]}`} role="alert">
          <div className={styles.message}>{alert.message}</div>
          <button
            type="button"
            className={styles.close}
            aria-label="Close"
            onClick={() => alertStore.getState().dismiss(alert.id)}
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
