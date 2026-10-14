import { useEffect } from 'react';
import { commandContext, commandRegistry, type Command, type CommandContext } from './registry';

/** Key names used in hotkey strings mapped to KeyboardEvent.key values (lower case). */
const KEY_ALIASES: Readonly<Record<string, string>> = {
  ins: 'insert',
  del: 'delete',
  esc: 'escape',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  space: ' ',
};

const MODIFIER_TOKENS: ReadonlySet<string> = new Set(['mod', 'ctrl', 'shift', 'alt', 'meta']);

const EDITABLE_TAGS: ReadonlySet<string> = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
}

export interface ParsedHotkey {
  key: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
}

/** Parses e.g. 'mod+shift+p'. 'mod' is ctrl, or meta on macOS. */
export function parseHotkey(hotkey: string, mac = isMacPlatform()): ParsedHotkey {
  const tokens = hotkey
    .toLowerCase()
    .split('+')
    .map((token) => token.trim())
    .filter((token) => token !== '');
  const key = tokens.filter((token) => !MODIFIER_TOKENS.has(token)).pop() ?? '';
  const hasMod = tokens.includes('mod');
  return {
    key: KEY_ALIASES[key] ?? key,
    ctrl: tokens.includes('ctrl') || (hasMod && !mac),
    meta: tokens.includes('meta') || (hasMod && mac),
    shift: tokens.includes('shift'),
    alt: tokens.includes('alt'),
  };
}

export type KeyEventLike = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>;

/** True when the event is exactly the hotkey (all modifiers must match). */
export function matchesHotkey(event: KeyEventLike, hotkey: string, mac = isMacPlatform()): boolean {
  const expected = parseHotkey(hotkey, mac);
  return (
    event.key.toLowerCase() === expected.key &&
    event.ctrlKey === expected.ctrl &&
    event.metaKey === expected.meta &&
    event.shiftKey === expected.shift &&
    event.altKey === expected.alt
  );
}

/** Human readable hotkey for menus and palettes, e.g. 'mod+shift+p' -> 'ctrl+shift+p'. */
export function formatHotkey(hotkey: string | undefined): string | undefined {
  if (hotkey === undefined) {
    return undefined;
  }
  return hotkey
    .split('+')
    .map((token) => (token === 'mod' ? 'ctrl' : token))
    .join('+');
}

/** True when keyboard input goes to a text field or select, where hotkeys must not interfere. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  // isContentEditable is not implemented by every DOM (e.g. jsdom), so the attribute is checked too.
  const editableAttribute = target.getAttribute('contenteditable');
  const contentEditable =
    target.isContentEditable || (editableAttribute !== null && editableAttribute !== 'false');
  return contentEditable || EDITABLE_TAGS.has(target.tagName);
}

/**
 * Runs the first command whose hotkey matches the event and can execute.
 * Does nothing while a modal dialog is open (dialogs handle their own keys) or when the focus is in
 * a text field, unless the command allows hotkeys in inputs. Returns true when a command ran.
 */
export function handleHotkey(
  event: KeyboardEvent,
  commands: Iterable<Command>,
  ctx: CommandContext,
): boolean {
  if (ctx.ui.getState().current !== undefined) {
    return false;
  }
  const inEditable = isEditableTarget(event.target);
  // Space activates the focused button / link natively.
  if (event.key === ' ' && event.target instanceof Element && event.target.closest('button, a')) {
    return false;
  }
  for (const command of commands) {
    if (command.hotkey === undefined || !matchesHotkey(event, command.hotkey)) {
      continue;
    }
    if (inEditable && !command.allowInInput) {
      continue;
    }
    if (!command.canExec(ctx)) {
      continue;
    }
    event.preventDefault();
    void command.exec(ctx);
    return true;
  }
  return false;
}

/** Listens to keydown on the window and dispatches hotkeys of the registered commands. */
export function useHotkeys(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      handleHotkey(event, Object.values(commandRegistry), commandContext);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
