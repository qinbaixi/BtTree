import { useEffect, useState } from 'react';
import { fetchProjectUpgrade, upgradeProject, type ProjectUpgradeState } from '../../lib/api';
import { getStorageItem, setStorageItem } from '../../lib/storage';
import { alerts } from '../../store/alertStore';
import { projectStore, useProjectStore } from '../../store/projectStore';
import styles from '../PluginBanner/PluginBanner.module.css';
import { t } from '../../i18n';

const DISMISS_KEY_PREFIX = 'owlbt.upgradeDismissed:';

/** Key that remembers a dismissal for one project and one set of missing types. */
function dismissKey(state: ProjectUpgradeState): string {
  const names = state.missing.map((item) => `${item.kind}:${item.name}`).sort();
  return `${DISMISS_KEY_PREFIX}${state.projectPath}|${names.join(',')}`;
}

/**
 * Offers to add the built-in types that are newer than the project (for example UtilitySelector in a
 * project created before 0.3.2) to owl-bt.json. "Dismiss" hides it until another type is missing.
 */
export default function UpgradeBanner({ treePath }: { treePath: string }) {
  const projectVersion = useProjectStore((state) => state.version);
  const [upgrade, setUpgrade] = useState<ProjectUpgradeState | undefined>(undefined);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  // Checks again after every project reload, so an upgrade made elsewhere hides the banner.
  useEffect(() => {
    let current = true;
    fetchProjectUpgrade(treePath).then(
      (state) => {
        if (current) {
          setUpgrade(state);
          setDismissed(state.missing.length > 0 && getStorageItem(dismissKey(state)) === '1');
        }
      },
      () => {
        // Without a project (or an older server) there is nothing to offer.
        if (current) {
          setUpgrade(undefined);
        }
      },
    );
    return () => {
      current = false;
    };
  }, [treePath, projectVersion]);

  if (dismissed || upgrade === undefined || upgrade.missing.length === 0) {
    return null;
  }

  const names = upgrade.missing.map((item) => item.name).join(', ');

  const add = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await upgradeProject(treePath, upgrade.hash);
      setUpgrade({ projectPath: result.projectPath, hash: result.hash, missing: [] });
      // The project watcher reloads it too; loading now makes the new types appear at once.
      await projectStore.getState().load(treePath);
      alerts.success(
        t('Added {names} to owl-bt.json.', {
          names: result.added.map((item) => item.name).join(', '),
        }),
      );
    } catch (err) {
      alerts.error(
        t('Could not update owl-bt.json: {message}', {
          message: err instanceof Error ? err.message : String(err),
        }),
      );
      // Shows the current state again, for example after the file changed on disk.
      fetchProjectUpgrade(treePath).then(setUpgrade, () => undefined);
    } finally {
      setBusy(false);
    }
  };

  const dismiss = (): void => {
    setStorageItem(dismissKey(upgrade), '1');
    setDismissed(true);
  };

  return (
    <div role="status" className={styles.banner} data-testid="upgrade-banner">
      <span className={styles.text}>
        {t(
          'This project was created by an older version and does not have the new built-in types: {names}.',
          { names },
        )}
      </span>
      <button type="button" className={styles.primary} onClick={() => void add()} disabled={busy}>
        {t('Add to owl-bt.json')}
      </button>
      <button type="button" className={styles.button} onClick={dismiss}>
        {t('Dismiss')}
      </button>
    </div>
  );
}
