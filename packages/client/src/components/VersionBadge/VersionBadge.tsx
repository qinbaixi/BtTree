import { useEffect, useState } from 'react';
import { VERSION, type AppUpdateState, type DesktopBridge } from '@owlbt/shared';
import styles from './VersionBadge.module.css';
import { t } from '../../i18n';

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

/** Update errors reported by the desktop app (in English) with their translatable prefix. */
const UPDATE_ERROR_PREFIXES: ReadonlyArray<
  [prefix: string, translate: (message: string) => string]
> = [
  [
    'Could not check for updates: ',
    (message) => t('Could not check for updates: {message}', { message }),
  ],
  [
    'Could not download the update: ',
    (message) => t('Could not download the update: {message}', { message }),
  ],
];

/** The update error in the UI language (the detail from the system stays as it is). */
export function translateUpdateError(error: string | undefined): string {
  if (error === undefined) {
    return t('The update failed.');
  }
  for (const [prefix, translate] of UPDATE_ERROR_PREFIXES) {
    if (error.startsWith(prefix)) {
      return translate(error.slice(prefix.length));
    }
  }
  return error;
}

/** Label, tooltip, icon and click action of the badge for an update state. */
export function badgeView(state: AppUpdateState): BadgeView {
  const current = `v${state.currentVersion}`;
  const latest = `v${state.latestVersion ?? ''}`;
  switch (state.status) {
    case 'idle':
      return {
        label: current,
        title: t('Click to check for updates.'),
        icon: 'fa-circle-info',
        tone: 'neutral',
        action: 'check',
      };
    case 'checking':
      return {
        label: t('{current} · Checking…', { current }),
        title: t('Checking for updates…'),
        icon: 'fa-spinner fa-spin',
        tone: 'neutral',
      };
    case 'latest':
      return {
        label: t('{current} · Latest', { current }),
        title: t('You have the latest version. Click to check again.'),
        icon: 'fa-circle-check',
        tone: 'neutral',
        action: 'check',
      };
    case 'available':
      return {
        label: t('Update to {latest}', { latest }),
        title: state.canInstall
          ? t(
              '{latest} is available (you have {current}). Click to download it; it installs when owl-bt restarts.',
              { latest, current },
            )
          : t('{latest} is available (you have {current}). Click to open the download page.', {
              latest,
              current,
            }),
        icon: state.canInstall ? 'fa-circle-down' : 'fa-arrow-up-right-from-square',
        tone: 'accent',
        action: 'download',
      };
    case 'downloading':
      return {
        label: t('Downloading {latest} · {percent}%', { latest, percent: state.percent ?? 0 }),
        title: t('Downloading {latest}…', { latest }),
        icon: 'fa-spinner fa-spin',
        tone: 'accent',
      };
    case 'downloaded':
      return {
        label: t('Restart to update to {latest}', { latest }),
        title: t(
          '{latest} is downloaded and installs the next time owl-bt starts. Click to restart now.',
          { latest },
        ),
        icon: 'fa-rotate-right',
        tone: 'success',
        action: 'install',
      };
    case 'error':
      return {
        label: t('{current} · Update failed', { current }),
        title: t('{error} Click to try again.', { error: translateUpdateError(state.error) }),
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
