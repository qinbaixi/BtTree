import { useState } from 'react';
import type { RefKind, TreeUsage } from '@owlbt/shared';
import { fetchUsages, type FileUsages, type ProjectUsages as UsagesResult } from '../../lib/api';
import { navigateTo } from '../../lib/appNavigation';
import { treeEditorUrl } from '../../lib/treeLinks';
import { t } from '../../i18n';
import styles from './ProjectUsages.module.css';

export interface ProjectUsagesProps {
  /** A tree file or owl-bt.json of the project to search. */
  path: string;
  kind: RefKind;
  name: string;
  /**
   * Called before a result opens its tree (e.g. to confirm leaving unsaved edits). Returning false
   * cancels. Receives the absolute path of the tree file.
   */
  beforeOpen?(treePath: string): boolean;
}

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; result: UsagesResult }
  | { status: 'error'; message: string };

function usageTitle(usage: TreeUsage): string {
  const name = usage.label ?? usage.type;
  if (usage.itemKind === 'decorator') {
    return t('{name} (decorator)', { name });
  }
  if (usage.itemKind === 'service') {
    return t('{name} (service)', { name });
  }
  return name;
}

function usageMeta(usage: TreeUsage): string {
  const parts = [usage.location];
  if (usage.property !== undefined) {
    parts.push(
      usage.isDefault ? t('{property} (default)', { property: usage.property }) : usage.property,
    );
  }
  return parts.join(' · ');
}

/** "N usage(s) in M file(s)" with the plural forms of both counts. */
function usagesSummary(usages: number, files: number): string {
  if (usages === 1) {
    return t('1 usage in 1 file');
  }
  return files === 1
    ? t('{count} usages in 1 file', { count: usages })
    : t('{count} usages in {files} files', { count: usages, files });
}

function countUsages(files: readonly FileUsages[]): number {
  return files.reduce((sum, file) => sum + file.usages.length, 0);
}

/**
 * "Find usages in project": searches every tree file of the project for a type or a blackboard key
 * and lists the results. A click opens the tree with the item selected.
 */
export function ProjectUsages({ path, kind, name, beforeOpen }: ProjectUsagesProps) {
  const [state, setState] = useState<State>({ status: 'idle' });

  const search = async () => {
    setState({ status: 'loading' });
    try {
      setState({ status: 'done', result: await fetchUsages(path, kind, name) });
    } catch (err) {
      setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  const open = (file: FileUsages, usage: TreeUsage) => {
    if (beforeOpen && !beforeOpen(file.path)) {
      return;
    }
    navigateTo(treeEditorUrl(file.path, usage));
  };

  const result = state.status === 'done' ? state.result : undefined;
  const total = result ? countUsages(result.files) : 0;

  return (
    <div className={styles.root}>
      <button
        type="button"
        className={styles.button}
        disabled={state.status === 'loading'}
        onClick={() => void search()}
      >
        <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />{' '}
        {state.status === 'loading' ? t('Searching…') : t('Find usages in project')}
      </button>
      {state.status === 'error' && (
        <p role="alert" className={styles.error}>
          {state.message}
        </p>
      )}
      {result && (
        <>
          <p className={styles.summary} role="status">
            {total === 0
              ? t('Not used in any tree file')
              : usagesSummary(total, result.files.length)}
          </p>
          {result.truncated && (
            <p className={styles.warning}>
              {t('Only the first tree files of the project were searched.')}
            </p>
          )}
          {result.errors.length > 0 && (
            <p className={styles.warning}>
              {t('Could not read: {files}', {
                files: result.errors.map((error) => error.relPath).join(', '),
              })}
            </p>
          )}
          <ul className={styles.files} aria-label={t('Usages in project')}>
            {result.files.map((file) => (
              <li key={file.path}>
                <span className={styles.fileName} title={file.path}>
                  {file.relPath}
                </span>
                <ul className={styles.usages}>
                  {file.usages.map((usage, index) => (
                    <li key={index}>
                      <button
                        type="button"
                        className={styles.usage}
                        title={t('Open {file} and select this item', { file: file.relPath })}
                        onClick={() => open(file, usage)}
                      >
                        <span className={styles.usageLabel}>{usageTitle(usage)}</span>
                        <span className={styles.usageMeta}>{usageMeta(usage)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
