import { useEffect, useRef, useState } from 'react';
import { commandContext, commandRegistry, execCommand } from '../../commands/registry';
import { useProjectStore } from '../../store/projectStore';
import { useTreeStore } from '../../store/treeStore';
import styles from './TopMenu.module.css';

export interface TopMenuItem {
  title: string;
  /** Command id in the command registry. */
  commandId: string;
  hotkey?: string;
}

export interface TopMenuSection {
  name: string;
  items: TopMenuItem[];
}

/** Menu layout. Items stay disabled until Phase 5 registers their commands. */
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
