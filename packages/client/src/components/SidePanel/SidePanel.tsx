import { useState, type ReactNode } from 'react';
import { getJson, setJson } from '../../lib/storage';
import styles from './SidePanel.module.css';

export interface SidePanelProps {
  title: string;
  /** Used for the persisted expand state (`panel-expand-<name>`). */
  name: string;
  position: 'left' | 'right';
  children?: ReactNode;
}

export function expandStorageKey(name: string): string {
  return `panel-expand-${name}`;
}

export default function SidePanel({ title, name, position, children }: SidePanelProps) {
  const [expanded, setExpanded] = useState<boolean>(() => {
    const stored = getJson<unknown>(expandStorageKey(name), true);
    return typeof stored === 'boolean' ? stored : true;
  });

  const setAndPersist = (value: boolean): void => {
    setExpanded(value);
    setJson(expandStorageKey(name), value);
  };

  const isLeft = position === 'left';

  if (!expanded) {
    return (
      <div className={`${styles.panel} ${styles.collapsed}`}>
        <div
          className={styles.expand}
          role="button"
          tabIndex={0}
          aria-label={`Expand ${title}`}
          title={`Expand ${title}`}
          onClick={() => setAndPersist(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') setAndPersist(true);
          }}
        >
          <i className={`fa-solid ${isLeft ? 'fa-angle-right' : 'fa-angle-left'}`} aria-hidden="true" />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <h2
        className={styles.title}
        role="button"
        tabIndex={0}
        onClick={() => setAndPersist(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setAndPersist(false);
        }}
      >
        {title}
        <i
          className={`fa-solid ${isLeft ? 'fa-angle-left' : 'fa-angle-right'} ${styles.hideIcon}`}
          aria-hidden="true"
        />
      </h2>
      <div className={styles.body}>
        <div className={styles.scroll}>{children}</div>
      </div>
    </div>
  );
}
