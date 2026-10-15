import { useState, type ReactNode } from 'react';
import { getJson, setJson } from '../../lib/storage';
import styles from './SidePanel.module.css';
import { t } from '../../i18n';

export interface SidePanelProps {
  title: string;
  /** Used for the persisted expand state (`panel-expand-<name>`). */
  name: string;
  position: 'left' | 'right';
  /** Width of the expanded panel in px (default 240). */
  width?: number;
  children?: ReactNode;
}

export function expandStorageKey(name: string): string {
  return `panel-expand-${name}`;
}

export default function SidePanel({ title, name, position, width, children }: SidePanelProps) {
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
          aria-label={t('Expand {title}', { title })}
          title={t('Expand {title}', { title })}
          onClick={() => setAndPersist(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') setAndPersist(true);
          }}
        >
          <i
            className={`fa-solid ${isLeft ? 'fa-angle-right' : 'fa-angle-left'}`}
            aria-hidden="true"
          />
          <span className={styles.railTitle} aria-hidden="true">
            {title}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.panel} style={width === undefined ? undefined : { flexBasis: width }}>
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
