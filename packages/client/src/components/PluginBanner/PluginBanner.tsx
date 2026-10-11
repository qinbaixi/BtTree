import { useEffect, useState } from 'react';
import { fetchPluginState, trustPlugin, type PluginState } from '../../lib/api';
import { alerts } from '../../store/alertStore';
import { treeStore, useTreeStore } from '../../store/treeStore';
import styles from './PluginBanner.module.css';

export const UNTRUSTED_MESSAGE =
  'This project has a plugin (owl-bt.js) that runs code on your computer when trees are loaded and saved. It is not running.';
export const CHANGED_MESSAGE =
  'The project plugin (owl-bt.js) changed since you trusted it. It runs code on your computer when trees are loaded and saved, and it is not running.';
export const DIRTY_CONFIRM =
  'Trusting the plugin reloads the tree, and unsaved changes are discarded. Continue?';

/**
 * Warning under the breadcrumb while the project's plugin is not trusted. "Trust and run" trusts the
 * current content and reloads the tree so that the plugin runs. "Dismiss" hides it for this page.
 */
export default function PluginBanner({ treePath }: { treePath: string }) {
  const dirty = useTreeStore((state) => state.dirty);
  const loadCount = useTreeStore((state) => state.loadCount);
  const [plugin, setPlugin] = useState<PluginState | undefined>(undefined);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  // Checks the plugin again after every tree load, so a trusted plugin hides the banner.
  useEffect(() => {
    let current = true;
    fetchPluginState(treePath).then(
      (state) => {
        if (current) {
          setPlugin(state);
        }
      },
      () => {
        // Without a state there is nothing to warn about.
        if (current) {
          setPlugin(undefined);
        }
      },
    );
    return () => {
      current = false;
    };
  }, [treePath, loadCount]);

  const visible =
    !dismissed && plugin !== undefined && plugin.pluginPath !== null && plugin.trusted === false;
  if (!visible) {
    return null;
  }

  const trustAndRun = async (): Promise<void> => {
    // Reloading the tree replaces the edits, so unsaved changes need an explicit go-ahead.
    if (dirty && !window.confirm(DIRTY_CONFIRM)) {
      return;
    }
    setBusy(true);
    try {
      setPlugin(await trustPlugin(treePath));
      await treeStore.getState().load(treePath);
    } catch (err) {
      alerts.error(
        `Could not trust the plugin: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="status" className={styles.banner}>
      <span className={styles.text}>{plugin.changed ? CHANGED_MESSAGE : UNTRUSTED_MESSAGE}</span>
      <button
        type="button"
        className={styles.primary}
        onClick={() => void trustAndRun()}
        disabled={busy}
      >
        Trust and run
      </button>
      <button type="button" className={styles.button} onClick={() => setDismissed(true)}>
        Dismiss
      </button>
    </div>
  );
}
