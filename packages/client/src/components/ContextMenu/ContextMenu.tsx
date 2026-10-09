import { useEffect, useLayoutEffect, useRef } from 'react';
import { execCommand, commandRegistry, type Command, type CommandContext } from '../../commands/registry';
import { formatHotkey } from '../../commands/useHotkeys';
import styles from './ContextMenu.module.css';

export interface ContextMenuState {
  /** Viewport coordinates of the right click. */
  x: number;
  y: number;
  commands: Command[];
}

/** Commands shown in the canvas context menu right now: those with an order that can execute, by order. */
export function getContextMenuCommands(ctx: CommandContext): Command[] {
  return Object.values(commandRegistry)
    .filter((command) => command.contextMenuOrder !== undefined && command.canExec(ctx))
    .sort((a, b) => (a.contextMenuOrder ?? 0) - (b.contextMenuOrder ?? 0));
}

export interface ContextMenuProps {
  menu?: ContextMenuState;
  onClose(): void;
}

/** Menu at the cursor position. Renders nothing when closed or when there is nothing to show. */
export default function ContextMenu({ menu, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const visible = menu !== undefined && menu.commands.length > 0;

  // Keep the menu inside the viewport. Written to the DOM directly so no extra render is needed.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!menu || !element) {
      return;
    }
    const left = Math.max(0, Math.min(menu.x, window.innerWidth - element.offsetWidth));
    const top = Math.max(0, Math.min(menu.y, window.innerHeight - element.offsetHeight));
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
  }, [menu]);

  useEffect(() => {
    if (!visible) {
      return undefined;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [visible, onClose]);

  if (!menu || !visible) {
    return null;
  }

  return (
    <div
      ref={ref}
      className={styles.menu}
      role="menu"
      onContextMenu={(event) => event.preventDefault()}
    >
      <ul>
        {menu.commands.map((command) => (
          <li key={command.id} role="none">
            <button
              type="button"
              role="menuitem"
              className={styles.item}
              onClick={() => {
                onClose();
                void execCommand(command.id);
              }}
            >
              {command.name}
              {command.hotkey && <span className={styles.hotkey}>{formatHotkey(command.hotkey)}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
