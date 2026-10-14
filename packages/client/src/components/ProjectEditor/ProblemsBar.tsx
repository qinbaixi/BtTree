import { useState } from 'react';
import type { ProjectIssue } from '@owlbt/shared';
import { t } from '../../i18n';
import styles from './ProjectEditor.module.css';

export interface ProblemsBarProps {
  issues: readonly ProjectIssue[];
  /** Why the last save was refused, if it was. */
  saveError?: string;
  /** Called when a problem is clicked. */
  onGo(issue: ProjectIssue): void;
}

/** Bottom bar with the validation problems. Collapsed it shows the counts; expanded, the list. */
export function ProblemsBar({ issues, saveError, onGo }: ProblemsBarProps) {
  const [open, setOpen] = useState(false);
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const warnings = issues.length - errors;
  const summary =
    errors + warnings === 0
      ? t('No problems')
      : [
          errors > 0 ? (errors === 1 ? t('1 error') : t('{count} errors', { count: errors })) : '',
          warnings > 0
            ? warnings === 1
              ? t('1 warning')
              : t('{count} warnings', { count: warnings })
            : '',
        ]
          .filter(Boolean)
          .join(t(', '));

  return (
    <section className={styles.problems} aria-label={t('Problems')}>
      <button
        type="button"
        className={styles.problemsToggle}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <i
          className={`fa-solid ${open ? 'fa-chevron-down' : 'fa-chevron-up'}`}
          aria-hidden="true"
        />
        {t('Problems: {summary}', { summary })}
        {saveError !== undefined && (
          <span className={styles.errorText}>
            {' · '}
            {t('Not saved: {message}', { message: saveError })}
          </span>
        )}
      </button>
      {open && (
        <ul className={styles.problemList}>
          {issues.map((issue) => (
            <li key={`${issue.path}:${issue.message}`}>
              <button type="button" className={styles.problemItem} onClick={() => onGo(issue)}>
                <i
                  className={`fa-solid ${issue.severity === 'error' ? 'fa-circle-xmark' : 'fa-triangle-exclamation'}`}
                  aria-hidden="true"
                />
                <span>{issue.message}</span>
                <span className={styles.mono}>{issue.path}</span>
              </button>
            </li>
          ))}
          {issues.length === 0 && <li className={styles.muted}>{t('Nothing to report.')}</li>}
        </ul>
      )}
    </section>
  );
}
