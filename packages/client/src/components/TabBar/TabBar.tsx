import { useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react';
import { useStore } from 'zustand';
import { handleTabHotkeyAlias, tabTitle } from '../../commands/tabCommands';
import { tabsStore as appTabsStore, type CloseChoice, type TabsStore } from '../../store/tabsStore';
import styles from './TabBar.module.css';
import { t } from '../../i18n';

export interface TabBarProps {
  /** Tabs to show (the application's tabs by default). */
  store?: TabsStore;
  /** Opens another tree ("Open tree…"); the + button is hidden without it. */
  onOpenTree?: () => void;
}

/** One tab per open tree, above the canvas. Middle click or × closes a tab. */
export default function TabBar({ store = appTabsStore, onOpenTree }: TabBarProps) {
  const tabs = useStore(store, (state) => state.tabs);
  const activeId = useStore(store, (state) => state.activeId);
  const closePrompt = useStore(store, (state) => state.closePrompt);
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeId]);

  // Ctrl+PageDown / Ctrl+PageUp / Ctrl+F4 (the main hotkeys are registered commands).
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      handleTabHotkeyAlias(event);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const close = (event: MouseEvent, id: string) => {
    event.stopPropagation();
    void store.getState().close(id);
  };

  const promptTab = closePrompt ? tabs.find((tab) => tab.id === closePrompt.tabId) : undefined;

  return (
    <>
      <div className={styles.bar} role="tablist" aria-label={t('Open trees')}>
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          const title = tabTitle(tab.path);
          return (
            <div
              key={tab.id}
              ref={active ? activeRef : undefined}
              role="tab"
              tabIndex={active ? 0 : -1}
              aria-selected={active}
              className={`${styles.tab} ${active ? styles.active : ''}`}
              title={tab.path}
              onClick={() => store.getState().activate(tab.id)}
              onMouseDown={(event) => {
                // Keeps the browser's middle-click autoscroll from starting.
                if (event.button === 1) {
                  event.preventDefault();
                }
              }}
              onAuxClick={(event) => {
                if (event.button === 1) {
                  close(event, tab.id);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  store.getState().activate(tab.id);
                }
              }}
            >
              <span className={styles.name}>
                {title}
                {tab.dirty && <span className={styles.dirty}>*</span>}
              </span>
              <button
                type="button"
                className={styles.close}
                aria-label={t('Close {name}', { name: title })}
                title={t('Close (Ctrl+W)')}
                tabIndex={-1}
                onClick={(event) => close(event, tab.id)}
              >
                ×
              </button>
            </div>
          );
        })}
        {onOpenTree && (
          <button
            type="button"
            className={styles.add}
            aria-label={t('Open tree…')}
            title={t('Open tree… (Ctrl+O)')}
            onClick={onOpenTree}
          >
            +
          </button>
        )}
      </div>
      {promptTab && (
        <CloseDialog
          name={tabTitle(promptTab.path)}
          onAnswer={(choice) => store.getState().answerClose(choice)}
        />
      )}
    </>
  );
}

function CloseDialog({ name, onAnswer }: { name: string; onAnswer(choice: CloseChoice): void }) {
  const saveRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement;
    saveRef.current?.focus();
    return () => {
      if (previous instanceof HTMLElement) {
        previous.focus();
      }
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent) => {
    // Keeps the editor hotkeys (window listeners) away while the question is open.
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      onAnswer('cancel');
    }
  };

  return (
    <div className={styles.backdrop} onMouseDown={() => onAnswer('cancel')}>
      <div
        className={styles.dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="tab-close-title"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <p id="tab-close-title" className={styles.message}>
          {t('Save changes to {name} before closing?', { name })}
        </p>
        <div className={styles.buttons}>
          <button
            ref={saveRef}
            type="button"
            className={styles.primary}
            onClick={() => onAnswer('save')}
          >
            {t('Save')}
          </button>
          <button type="button" onClick={() => onAnswer('discard')}>
            {t('Discard')}
          </button>
          <button type="button" onClick={() => onAnswer('cancel')}>
            {t('Cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
