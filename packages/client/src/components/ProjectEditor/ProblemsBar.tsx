import { useState } from 'react';
import type { ProjectIssue } from '@owlbt/shared';
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
      ? 'No problems'
      : [
          errors > 0 ? `${errors} error${errors === 1 ? '' : 's'}` : '',
          warnings > 0 ? `${warnings} warning${warnings === 1 ? '' : 's'}` : '',
        ]
          .filter(Boolean)
          .join(', ');

  return (
    <section className={styles.problems} aria-label="Problems">
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
        Problems: {summary}
        {saveError !== undefined && (
          <span className={styles.errorText}> · Not saved: {saveError}</span>
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
          {issues.length === 0 && <li className={styles.muted}>Nothing to report.</li>}
        </ul>
      )}
    </section>
  );
}
