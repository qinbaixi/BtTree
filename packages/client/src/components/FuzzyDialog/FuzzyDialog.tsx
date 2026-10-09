import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { fuzzyFilter, highlightMatches } from '@owlbt/shared';
import { dialogStore, useDialogStore, type FuzzyItem } from '../../store/dialogStore';
import styles from './FuzzyDialog.module.css';

/** Delay between the last keystroke and the filter update. */
export const FILTER_DEBOUNCE_MS = 200;

export interface FuzzyDialogProps {
  items: FuzzyItem[];
  /** Called with the id of the accepted item (Enter or click). */
  onAccept(id: string): void;
  /** Called on Escape or a backdrop click. */
  onClose(): void;
  label?: string;
}

/** Modal list with a fuzzy filter. Up/Down wrap around, Enter accepts, Escape closes. */
export function FuzzyDialog({ items, onAccept, onClose, label = 'Select item' }: FuzzyDialogProps) {
  const [query, setQuery] = useState('');
  // The filter lags the input by FILTER_DEBOUNCE_MS; it is set together with the selection reset.
  const [filter, setFilter] = useState('');
  const [index, setIndex] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const itemRefs = useRef<Array<HTMLLIElement | null>>([]);

  const matches = useMemo(() => fuzzyFilter(items, filter, (item) => item.name), [items, filter]);
  const active = matches.length > 0 ? Math.min(index, matches.length - 1) : -1;

  // Return the focus to whatever had it before the dialog opened.
  useEffect(() => {
    const previous = document.activeElement;
    return () => {
      if (previous instanceof HTMLElement) {
        previous.focus();
      }
    };
  }, []);

  useEffect(() => {
    if (active >= 0) {
      itemRefs.current[active]?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [active]);

  useEffect(() => {
    return () => clearTimeout(timer.current);
  }, []);

  const onQueryChange = (value: string) => {
    setQuery(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setFilter(value);
      setIndex(0);
    }, FILTER_DEBOUNCE_MS);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (matches.length === 0) {
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIndex((active + 1) % matches.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIndex((active - 1 + matches.length) % matches.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      onAccept(matches[active].id);
    }
  };

  return (
    <div
      className={styles.backdrop}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onKeyDown={onKeyDown}
      >
        <input
          type="text"
          autoFocus
          aria-label={label}
          className={styles.input}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        <ul
          className={styles.list}
          role="listbox"
          // Keeps the focus in the input when the list is clicked or scrolled.
          onMouseDown={(event) => event.preventDefault()}
        >
          {matches.map((item, i) => (
            <li
              key={item.id}
              ref={(element) => {
                itemRefs.current[i] = element;
              }}
              role="option"
              aria-selected={i === active}
              data-selected={i === active ? 'true' : undefined}
              className={`${styles.item} ${item.color ? styles.colored : ''} ${i === active ? styles.selected : ''}`}
              style={item.color ? { borderLeftColor: item.color } : undefined}
              onClick={() => onAccept(item.id)}
            >
              {item.icon && <i className={`fa-solid fa-${item.icon} ${styles.icon}`} aria-hidden="true" />}
              <span className={styles.label}>
                {highlightMatches(item.name, filter).map((part, partIndex) =>
                  part.match ? (
                    <mark key={partIndex}>{part.text}</mark>
                  ) : (
                    <span key={partIndex}>{part.text}</span>
                  ),
                )}
              </span>
              {item.hint && <span className={styles.hint}>{item.hint}</span>}
            </li>
          ))}
        </ul>
        {matches.length === 0 && <p className={styles.empty}>No matching items</p>}
      </div>
    </div>
  );
}

/** Renders the dialog requested through the dialog store, if any. */
export function FuzzyDialogHost() {
  const current = useDialogStore((state) => state.current);
  if (!current) {
    return null;
  }
  return (
    <FuzzyDialog
      key={current.id}
      items={current.items}
      onAccept={(id) => dialogStore.getState().accept(id)}
      onClose={() => dialogStore.getState().close()}
    />
  );
}
