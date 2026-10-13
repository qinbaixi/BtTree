import { useEffect, useState } from 'react';
import { VERSION, type AppUpdateState, type DesktopBridge } from '@owlbt/shared';
import styles from './VersionBadge.module.css';

declare global {
  interface Window {
    /** Set by the desktop app's preload; undefined when the editor runs in a browser. */
    owlbtDesktop?: DesktopBridge;
  }
}

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning';

export interface BadgeView {
  label: string;
  title: string;
  icon: string;
  tone: BadgeTone;
  /** What a click does; undefined while it cannot do anything. */
  action?: 'check' | 'download' | 'install';
}

/** Label, tooltip, icon and click action of the badge for an update state. */
export function badgeView(state: AppUpdateState): BadgeView {
  const current = `v${state.currentVersion}`;
  const latest = `v${state.latestVersion ?? ''}`;
  switch (state.status) {
    case 'idle':
      return {
        label: current,
        title: 'Click to check for updates.',
        icon: 'fa-circle-info',
        tone: 'neutral',
        action: 'check',
      };
    case 'checking':
      return {
        label: `${current} · Checking…`,
        title: 'Checking for updates…',
        icon: 'fa-spinner fa-spin',
        tone: 'neutral',
      };
    case 'latest':
      return {
        label: `${current} · Latest`,
        title: 'You have the latest version. Click to check again.',
        icon: 'fa-circle-check',
        tone: 'neutral',
        action: 'check',
      };
    case 'available':
      return {
        label: `Update to ${latest}`,
        title: state.canInstall
          ? `${latest} is available (you have ${current}). Click to download it; it installs when owl-bt restarts.`
          : `${latest} is available (you have ${current}). Click to open the download page.`,
        icon: state.canInstall ? 'fa-circle-down' : 'fa-arrow-up-right-from-square',
        tone: 'accent',
        action: 'download',
      };
    case 'downloading':
      return {
        label: `Downloading ${latest} · ${state.percent ?? 0}%`,
        title: `Downloading ${latest}…`,
        icon: 'fa-spinner fa-spin',
        tone: 'accent',
      };
    case 'downloaded':
      return {
        label: `Restart to update to ${latest}`,
        title: `${latest} is downloaded and installs the next time owl-bt starts. Click to restart now.`,
        icon: 'fa-rotate-right',
        tone: 'success',
        action: 'install',
      };
    case 'error':
      return {
        label: `${current} · Update failed`,
        title: `${state.error ?? 'The update failed.'} Click to try again.`,
        icon: 'fa-triangle-exclamation',
        tone: 'warning',
        action: 'check',
      };
  }
}

/**
 * The app version in the bottom-left corner. In the desktop app it shows whether a newer release exists;
 * a click checks again, downloads the update, or restarts into it. In a browser it only shows the version.
 */
export default function VersionBadge() {
  const bridge = typeof window === 'undefined' ? undefined : window.owlbtDesktop;
  const [state, setState] = useState<AppUpdateState | undefined>(undefined);

  useEffect(() => {
    if (!bridge) {
      return;
    }
    let current = true;
    const stop = bridge.onUpdateState((next) => setState(next));
    bridge.getUpdateState().then(
      (next) => {
        if (current) {
          setState(next);
        }
      },
      () => {
        // Without a state the badge just shows the version.
      },
    );
    return () => {
      current = false;
      stop();
    };
  }, [bridge]);

  if (!bridge || !state) {
    return (
      <div className={styles.badge} title={`owl-bt v${VERSION}`}>
        v{VERSION}
      </div>
    );
  }

  const view = badgeView(state);
  // The main process reports every state change through onUpdateState, so results are not needed here.
  const run = (): void => {
    const ignore = (): void => undefined;
    if (view.action === 'check') {
      bridge.checkForUpdate().then(ignore, ignore);
    } else if (view.action === 'download') {
      bridge.downloadUpdate().then(ignore, ignore);
    } else if (view.action === 'install') {
      bridge.installUpdate().then(ignore, ignore);
    }
  };

  return (
    <button
      type="button"
      className={`${styles.badge} ${styles.button} ${styles[view.tone]}`}
      title={view.title}
      aria-label={view.title}
      onClick={run}
      disabled={view.action === undefined}
    >
      <i className={`fa-solid ${view.icon}`} aria-hidden="true" />
      <span>{view.label}</span>
    </button>
  );
}
