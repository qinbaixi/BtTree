import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { FA_SOLID_ICONS } from '../../lib/faIcons.generated';
import { countIcons, filterIcons } from '../../lib/icons';
import styles from './ProjectEditor.module.css';

/** Most icons shown at once; the rest is reached by typing. */
export const ICON_RESULT_LIMIT = 300;
/** Columns of the grid; Up and Down move by one row. */
const GRID_COLUMNS = 8;

export interface IconPickerProps {
  current?: string;
  /** Called with the chosen name. Undefined clears the icon. */
  onPick(name: string | undefined): void;
  onClose(): void;
}

/** Modal grid of Font Awesome 6 solid icons. Enter picks the highlighted icon, Escape closes. */
export function IconPicker({ current, onPick, onClose }: IconPickerProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => filterIcons(FA_SOLID_ICONS, query, ICON_RESULT_LIMIT), [query]);
  const total = useMemo(() => countIcons(FA_SOLID_ICONS, query), [query]);
  const index = matches.length > 0 ? Math.min(active, matches.length - 1) : -1;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const move = (delta: number) => {
    if (matches.length === 0) {
      return;
    }
    setActive((index + delta + matches.length) % matches.length);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (index >= 0) {
        onPick(matches[index]);
      }
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(GRID_COLUMNS);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-GRID_COLUMNS);
    }
  };

  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
      <div
        className={styles.iconDialog}
        role="dialog"
        aria-modal="true"
        aria-label="Choose icon"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={styles.iconSearch}>
          <input
            ref={inputRef}
            type="search"
            className={styles.input}
            placeholder="Search icons, e.g. arrow or question"
            aria-label="Search icons"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          <button type="button" className={styles.button} onClick={() => onPick(undefined)}>
            No icon
          </button>
        </div>
        <div className={styles.iconInfo}>
          {total > matches.length
            ? `Showing ${matches.length} of ${total}. Type to narrow down.`
            : `${total} icon${total === 1 ? '' : 's'}`}
        </div>
        <div className={styles.iconGrid} role="listbox" aria-label="Icons">
          {matches.map((name, i) => (
            <button
              key={name}
              type="button"
              role="option"
              aria-selected={i === index}
              aria-label={name}
              title={name}
              className={[
                styles.iconCell,
                i === index ? styles.iconCellActive : '',
                name === current ? styles.iconCellCurrent : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onMouseEnter={() => setActive(i)}
              onClick={() => onPick(name)}
            >
              <i className={`fa-solid fa-${name}`} aria-hidden="true" />
              <span className={styles.iconName}>{name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
