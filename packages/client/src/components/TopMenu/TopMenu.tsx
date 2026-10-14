import { useEffect, useRef, useState } from 'react';
import { commandContext, commandRegistry, execCommand } from '../../commands/registry';
import {
  EDIT_PROJECT_COMMAND_ID,
  EXPORT_COMMAND_IDS,
  RUN_COMMAND_IDS,
  THEME_COMMAND_IDS,
} from '../../commands/coreCommands';
import { TAB_COMMAND_IDS } from '../../commands/tabCommands';
import { VIEW_COMMAND_IDS } from '../../commands/viewCommands';
import { LANGUAGE_COMMAND_IDS, languageItemTitle } from '../../commands/languageCommands';
import { getLanguage, t, type Language } from '../../i18n';
import { useProjectStore } from '../../store/projectStore';
import { useRunStore } from '../../store/runStore';
import { useTreeStore } from '../../store/treeStore';
import { useTheme, type ThemeId } from '../../lib/theme';
import styles from './TopMenu.module.css';

export interface TopMenuItem {
  title: string;
  /** Command id in the command registry. */
  commandId: string;
  hotkey?: string;
  /** Theme this item switches to; the item shows a check mark while that theme is active. */
  themeId?: ThemeId;
  /** Language this item switches to; the item shows a check mark while that language is active. */
  languageId?: Language;
}

export interface TopMenuSection {
  name: string;
  items: TopMenuItem[];
}

/** Menu layout. Items stay disabled until their commands can execute. */
export const TOP_MENU_SECTIONS: TopMenuSection[] = [
  {
    name: t('File'),
    items: [
      { title: t('Open tree…'), commandId: TAB_COMMAND_IDS.open, hotkey: 'Ctrl+O' },
      { title: t('Save'), commandId: 'core:Save', hotkey: 'Ctrl+S' },
      { title: t('Save all'), commandId: TAB_COMMAND_IDS.saveAll, hotkey: 'Ctrl+Shift+S' },
      { title: t('Close tab'), commandId: TAB_COMMAND_IDS.close, hotkey: 'Ctrl+W' },
      { title: t('Export: Erlang'), commandId: EXPORT_COMMAND_IDS.erlang },
      { title: t('Export: Lua'), commandId: EXPORT_COMMAND_IDS.lua },
      { title: t('Export: TypeScript'), commandId: EXPORT_COMMAND_IDS.ts },
      { title: t('Export: C#'), commandId: EXPORT_COMMAND_IDS.cs },
      { title: t('Export: Go'), commandId: EXPORT_COMMAND_IDS.go },
      { title: t('Export: All formats'), commandId: EXPORT_COMMAND_IDS.all },
      { title: t('Edit project types…'), commandId: EDIT_PROJECT_COMMAND_ID },
    ],
  },
  {
    name: t('Edit'),
    items: [
      { title: t('Undo'), commandId: 'core:Undo', hotkey: 'Ctrl+Z' },
      { title: t('Redo'), commandId: 'core:Redo', hotkey: 'Ctrl+Y' },
      { title: t('Find in tree'), commandId: VIEW_COMMAND_IDS.find, hotkey: 'Ctrl+F' },
    ],
  },
  {
    name: t('View'),
    items: [
      { title: t('Command Palette'), commandId: 'core:CommandPalette', hotkey: 'Ctrl+Shift+P' },
      {
        title: t('Collapse / Expand subtree'),
        commandId: VIEW_COMMAND_IDS.toggleCollapse,
        hotkey: 'Space',
      },
      { title: t('Collapse all'), commandId: VIEW_COMMAND_IDS.collapseAll },
      { title: t('Expand all'), commandId: VIEW_COMMAND_IDS.expandAll },
      { title: t('Theme: Light'), commandId: THEME_COMMAND_IDS.light, themeId: 'light' },
      { title: t('Theme: Classic dark'), commandId: THEME_COMMAND_IDS.classic, themeId: 'classic' },
      { title: languageItemTitle('en'), commandId: LANGUAGE_COMMAND_IDS.en, languageId: 'en' },
      { title: languageItemTitle('zh'), commandId: LANGUAGE_COMMAND_IDS.zh, languageId: 'zh' },
    ],
  },
  {
    name: t('Run'),
    items: [
      { title: t('Toggle run mode'), commandId: RUN_COMMAND_IDS.toggle, hotkey: 'F5' },
      { title: t('Step'), commandId: RUN_COMMAND_IDS.step, hotkey: 'F10' },
      { title: t('Step back'), commandId: RUN_COMMAND_IDS.stepBack, hotkey: 'Shift+F10' },
      { title: t('Play'), commandId: RUN_COMMAND_IDS.play, hotkey: 'F8' },
      { title: t('Pause'), commandId: RUN_COMMAND_IDS.pause, hotkey: 'F8' },
      { title: t('Reset'), commandId: RUN_COMMAND_IDS.reset },
    ],
  },
];

function isEnabled(commandId: string): boolean {
  const command = commandRegistry[commandId];
  return command !== undefined && command.canExec(commandContext);
}

export default function TopMenu() {
  const [openSection, setOpenSection] = useState<string | undefined>();
  const rootRef = useRef<HTMLUListElement>(null);
  const theme = useTheme();

  // Re-evaluate enabled state when the tree (incl. undo/redo) or the project changes.
  useTreeStore((state) => state.version);
  useProjectStore((state) => state.version);
  const runActive = useRunStore((state) => state.active);
  useRunStore((state) => state.history.length);
  useRunStore((state) => state.playing);

  useEffect(() => {
    if (openSection === undefined) {
      return undefined;
    }
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpenSection(undefined);
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpenSection(undefined);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openSection]);

  return (
    <ul className={styles.menu} ref={rootRef}>
      <li className={styles.brand}>
        <span className={styles.brandDot} aria-hidden="true" />
        owl-bt
      </li>
      {TOP_MENU_SECTIONS.map((section) => {
        const isOpen = openSection === section.name;
        return (
          <li key={section.name} className={styles.section}>
            <button
              type="button"
              className={styles.toggle}
              aria-haspopup="menu"
              aria-expanded={isOpen}
              onClick={() => setOpenSection(isOpen ? undefined : section.name)}
            >
              {section.name}
            </button>
            {isOpen && (
              <ul className={styles.dropdown} role="menu">
                {section.items.map((item) => {
                  const enabled = isEnabled(item.commandId);
                  const checkable = item.themeId !== undefined || item.languageId !== undefined;
                  const checked =
                    (item.themeId !== undefined && item.themeId === theme) ||
                    (item.languageId !== undefined && item.languageId === getLanguage());
                  return (
                    <li key={item.commandId} role="none">
                      <button
                        type="button"
                        role="menuitem"
                        className={styles.item}
                        disabled={!enabled}
                        onClick={() => {
                          setOpenSection(undefined);
                          void execCommand(item.commandId);
                        }}
                      >
                        {checkable && (
                          <i
                            className={`fa-solid fa-check ${styles.check} ${checked ? '' : styles.checkHidden}`}
                            aria-hidden="true"
                          />
                        )}
                        {item.title}
                        {item.hotkey && <span className={styles.hotkey}>{item.hotkey}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
      <li className={styles.runItem}>
        <button
          type="button"
          className={`${styles.runButton} ${runActive ? styles.runButtonActive : ''}`}
          aria-pressed={runActive}
          title={runActive ? t('Exit run mode (F5)') : t('Simulate the tree (F5)')}
          disabled={!isEnabled(RUN_COMMAND_IDS.toggle)}
          onClick={() => void execCommand(RUN_COMMAND_IDS.toggle)}
        >
          <i className={`fa-solid ${runActive ? 'fa-stop' : 'fa-play'}`} aria-hidden="true" />
          {runActive ? t('Exit run') : t('Run')}
        </button>
      </li>
    </ul>
  );
}
