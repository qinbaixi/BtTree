import { useEffect, useRef, useState } from 'react';
import { commandContext, commandRegistry, execCommand } from '../../commands/registry';
import { THEME_COMMAND_IDS } from '../../commands/coreCommands';
import { useProjectStore } from '../../store/projectStore';
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
}

export interface TopMenuSection {
  name: string;
  items: TopMenuItem[];
}

/** Menu layout. Items stay disabled until their commands can execute. */
export const TOP_MENU_SECTIONS: TopMenuSection[] = [
  {
    name: 'File',
    items: [{ title: 'Save', commandId: 'core:Save', hotkey: 'Ctrl+S' }],
  },
  {
    name: 'Edit',
    items: [
      { title: 'Undo', commandId: 'core:Undo', hotkey: 'Ctrl+Z' },
      { title: 'Redo', commandId: 'core:Redo', hotkey: 'Ctrl+Y' },
    ],
  },
  {
    name: 'View',
    items: [
      { title: 'Command Palette', commandId: 'core:CommandPalette', hotkey: 'Ctrl+Shift+P' },
      { title: 'Theme: Light', commandId: THEME_COMMAND_IDS.light, themeId: 'light' },
      { title: 'Theme: Classic dark', commandId: THEME_COMMAND_IDS.classic, themeId: 'classic' },
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
                  const checked = item.themeId !== undefined && item.themeId === theme;
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
                        {item.themeId !== undefined && (
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
    </ul>
  );
}
