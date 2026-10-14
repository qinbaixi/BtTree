import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { Selection } from '@owlbt/shared';
import { searchStore, useSearchStore } from '../../store/searchStore';
import { treeStore } from '../../store/treeStore';
import { focusNode } from './viewportStore';
import styles from './TreeSearch.module.css';

export interface TreeSearchProps {
  /** Results of the current query in visual order (see searchTree). */
  matches: readonly Selection[];
}

/**
 * Selects and focuses result `index` (wrapping around). Collapsed ancestors are expanded by the
 * collapse sync when the selection moves into a collapsed branch.
 */
export function jumpToMatch(matches: readonly Selection[], index: number): void {
  if (matches.length === 0) {
    return;
  }
  const wrapped = ((index % matches.length) + matches.length) % matches.length;
  const target = matches[wrapped];
  searchStore.getState().setIndex(wrapped);
  treeStore.getState().select(target);
  focusNode(target.nodeId);
}

/** Find box over the tree canvas: Ctrl+F opens it, Enter / Shift+Enter jump, Escape closes. */
export default function TreeSearch({ matches }: TreeSearchProps) {
  const open = useSearchStore((state) => state.open);
  const query = useSearchStore((state) => state.query);
  const index = useSearchStore((state) => state.index);
  const focusSeq = useSearchStore((state) => state.focusSeq);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [open, focusSeq]);

  if (!open) {
    return null;
  }

  const current = index >= 0 && index < matches.length ? index + 1 : 0;
  const next = (delta: 1 | -1): void => {
    if (index < 0 || index >= matches.length) {
      jumpToMatch(matches, delta > 0 ? 0 : matches.length - 1);
    } else {
      jumpToMatch(matches, index + delta);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      next(event.shiftKey ? -1 : 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      searchStore.getState().close();
    }
  };

  const noMatch = query.trim() !== '' && matches.length === 0;

  return (
    <div className={styles.search} role="search">
      <i className={`fa-solid fa-magnifying-glass ${styles.icon}`} aria-hidden="true" />
      <input
        ref={inputRef}
        type="text"
        className={`${styles.input} ${noMatch ? styles.noMatch : ''}`}
        placeholder="Find in tree"
        aria-label="Find in tree"
        value={query}
        spellCheck={false}
        onChange={(event) => searchStore.getState().setQuery(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <span className={styles.count} aria-live="polite" data-testid="tree-search-count">
        {current} / {matches.length}
      </span>
      <button
        type="button"
        className={styles.button}
        title="Previous match (Shift+Enter)"
        aria-label="Previous match"
        disabled={matches.length === 0}
        onClick={() => next(-1)}
      >
        <i className="fa-solid fa-chevron-up" aria-hidden="true" />
      </button>
      <button
        type="button"
        className={styles.button}
        title="Next match (Enter)"
        aria-label="Next match"
        disabled={matches.length === 0}
        onClick={() => next(1)}
      >
        <i className="fa-solid fa-chevron-down" aria-hidden="true" />
      </button>
      <button
        type="button"
        className={styles.button}
        title="Close (Escape)"
        aria-label="Close search"
        onClick={() => searchStore.getState().close()}
      >
        <i className="fa-solid fa-xmark" aria-hidden="true" />
      </button>
    </div>
  );
}
