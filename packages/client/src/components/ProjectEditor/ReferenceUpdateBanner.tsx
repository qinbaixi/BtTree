import { useEffect, useState } from 'react';
import type { RefRename } from '@owlbt/shared';
import { updateReferences, type ChangedTree, type UpdateReferencesResult } from '../../lib/api';
import { getDirtyTreePaths } from '../../lib/dirtyTrees';
import { alerts } from '../../store/alertStore';
import { projectEditorStore, useProjectEditorStore } from '../../store/projectEditorStore';
import { treeStore } from '../../store/treeStore';
import styles from './ProjectEditor.module.css';
import refStyles from './References.module.css';

/** Asks before leaving the project editor with unsaved edits. True when it may leave. */
export function confirmLeaveProject(): boolean {
  if (!projectEditorStore.getState().dirty) {
    return true;
  }
  return window.confirm('You have unsaved changes to the project types. Leave without saving?');
}

/** Paths compared the way the file system does: separators unified, case-insensitive on Windows. */
export function normalizeTreePath(path: string): string {
  const unified = path.replace(/\\/g, '/');
  return /^[A-Za-z]:\//.test(unified) ? unified.toLowerCase() : unified;
}

/** Trees with unsaved edits in this tab or another one (see dirtyTrees). */
export function openDirtyTreePaths(): Set<string> {
  const paths = getDirtyTreePaths();
  const { treePath, dirty } = treeStore.getState();
  if (dirty && treePath) {
    paths.push(treePath);
  }
  return new Set(paths.map(normalizeTreePath));
}

/** "Old → New" list of renames, e.g. `MoveTo → Walk, key Target → Goal`. */
export function describeRenames(renames: readonly RefRename[]): string {
  return renames
    .map(
      (rename) => `${rename.kind === 'blackboardKey' ? 'key ' : ''}${rename.from} → ${rename.to}`,
    )
    .join(', ');
}

interface Check {
  renames: RefRename[];
  result?: UpdateReferencesResult;
  error?: string;
}

/**
 * After a save that renamed types or blackboard keys: counts the tree files that still use the old
 * names and offers to update them. Trees with unsaved edits in an open editor are skipped.
 */
export function ReferenceUpdateBanner() {
  const renames = useProjectEditorStore((state) => state.savedRenames);
  const projectPath = useProjectEditorStore((state) => state.projectPath);
  const [check, setCheck] = useState<Check | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!projectPath || renames.length === 0) {
      return undefined;
    }
    let cancelled = false;
    updateReferences(projectPath, renames, { dryRun: true }).then(
      (result) => {
        if (cancelled) {
          return;
        }
        if (result.changed.length === 0) {
          projectEditorStore.getState().clearSavedRenames();
        } else {
          setCheck({ renames, result });
        }
      },
      (err: unknown) => {
        if (!cancelled) {
          setCheck({ renames, error: err instanceof Error ? err.message : String(err) });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [projectPath, renames]);

  if (!projectPath || renames.length === 0 || !check || check.renames !== renames) {
    return null;
  }

  const dismiss = () => {
    projectEditorStore.getState().clearSavedRenames();
    setCheck(undefined);
  };

  if (check.error !== undefined || !check.result) {
    return (
      <div role="alert" className={styles.bannerError}>
        <span>{`Could not check the tree files for renamed names: ${check.error ?? ''}`}</span>
        <button type="button" className={styles.button} onClick={dismiss}>
          Dismiss
        </button>
      </div>
    );
  }

  const dirtyPaths = openDirtyTreePaths();
  const isOpenDirty = (file: ChangedTree) => dirtyPaths.has(normalizeTreePath(file.path));
  const files = check.result.changed;
  const writable = files.filter((file) => !isOpenDirty(file));
  const skipped = files.filter(isOpenDirty);

  const update = async () => {
    setBusy(true);
    try {
      const result = await updateReferences(projectPath, renames, {
        skip: skipped.map((file) => file.path),
      });
      const written = result.changed.filter((file) => !file.skipped);
      alerts.success(`Updated ${written.length} tree file${written.length === 1 ? '' : 's'}`);
      const notWritten = result.changed.filter((file) => file.skipped);
      if (notWritten.length > 0) {
        alerts.warning(
          `Not updated (unsaved edits in an open editor): ${notWritten.map((f) => f.relPath).join(', ')}`,
        );
      }
      if (result.errors.length > 0) {
        alerts.error(
          `Could not update: ${result.errors.map((e) => `${e.relPath} (${e.error})`).join(', ')}`,
        );
      }
      dismiss();
    } catch (err) {
      alerts.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="status" className={refStyles.banner} aria-label="Update tree files">
      <div className={refStyles.bannerRow}>
        <span className={refStyles.bannerText}>
          {`Renamed ${describeRenames(renames)}. ${files.length} tree file${files.length === 1 ? ' uses' : 's use'} the old name${renames.length === 1 ? '' : 's'}.`}
        </span>
        <button
          type="button"
          className={`${styles.button} ${styles.primary}`}
          disabled={busy || writable.length === 0}
          onClick={() => void update()}
        >
          {`Also update ${writable.length} tree file${writable.length === 1 ? '' : 's'}`}
        </button>
        <button type="button" className={styles.button} disabled={busy} onClick={dismiss}>
          Dismiss
        </button>
      </div>
      <ul className={refStyles.files}>
        {files.map((file) => (
          <li key={file.path} className={isOpenDirty(file) ? refStyles.skipped : undefined}>
            {`${file.relPath} (${file.count})`}
            {isOpenDirty(file) && ' — open with unsaved changes, will be skipped'}
          </li>
        ))}
      </ul>
    </div>
  );
}
