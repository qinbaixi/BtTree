import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAlertStore } from '../store/alertStore';
import { createDialogStore } from '../store/dialogStore';
import { createProjectStore } from '../store/projectStore';
import { createTreeStore } from '../store/treeStore';
import { commandRegistry, type Command, type CommandContext } from './registry';
import { formatHotkey, handleHotkey, matchesHotkey, useHotkeys } from './useHotkeys';

function makeContext(): CommandContext {
  const project = createProjectStore();
  return {
    tree: createTreeStore(),
    project,
    alerts: createAlertStore(),
    ui: createDialogStore(project),
  };
}

function key(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
}

describe('matchesHotkey', () => {
  it('treats mod as ctrl on non-mac platforms and as meta on macOS', () => {
    const ctrlS = key({ key: 's', ctrlKey: true });
    const metaS = key({ key: 's', metaKey: true });
    expect(matchesHotkey(ctrlS, 'mod+s', false)).toBe(true);
    expect(matchesHotkey(metaS, 'mod+s', false)).toBe(false);
    expect(matchesHotkey(metaS, 'mod+s', true)).toBe(true);
  });

  it('requires exactly the listed modifiers', () => {
    expect(matchesHotkey(key({ key: 'ArrowUp' }), 'up')).toBe(true);
    expect(matchesHotkey(key({ key: 'ArrowUp', shiftKey: true }), 'up')).toBe(false);
    expect(matchesHotkey(key({ key: 'ArrowUp', shiftKey: true }), 'shift+up')).toBe(true);
    expect(matchesHotkey(key({ key: 'ArrowLeft', ctrlKey: true }), 'shift+left')).toBe(false);
  });

  it('maps the short key names and ignores the case of the key', () => {
    expect(matchesHotkey(key({ key: 'Insert' }), 'ins')).toBe(true);
    expect(matchesHotkey(key({ key: 'Delete' }), 'del')).toBe(true);
    expect(matchesHotkey(key({ key: 'P', ctrlKey: true, shiftKey: true }), 'mod+shift+p', false)).toBe(true);
  });
});

describe('formatHotkey', () => {
  it('shows mod as ctrl', () => {
    expect(formatHotkey('mod+shift+p')).toBe('ctrl+shift+p');
    expect(formatHotkey('ins')).toBe('ins');
    expect(formatHotkey(undefined)).toBeUndefined();
  });
});

describe('handleHotkey', () => {
  let ran: string[];
  let ctx: CommandContext;
  let commands: Command[];

  function command(overrides: Partial<Command> & Pick<Command, 'id'>): Command {
    return {
      name: overrides.id,
      canExec: () => true,
      exec: () => {
        ran.push(overrides.id);
      },
      ...overrides,
    };
  }

  beforeEach(() => {
    ran = [];
    ctx = makeContext();
    commands = [
      command({ id: 'test:delete', hotkey: 'del' }),
      command({ id: 'test:save', hotkey: 'mod+s', allowInInput: true }),
      command({ id: 'test:blocked', hotkey: 'mod+z', canExec: () => false }),
    ];
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  /** Dispatches the event on the element so that event.target is that element. */
  function dispatchOn(target: EventTarget, event: KeyboardEvent): boolean {
    let handled = false;
    const listener = (e: Event) => {
      handled = handleHotkey(e as KeyboardEvent, commands, ctx);
    };
    target.addEventListener('keydown', listener);
    target.dispatchEvent(event);
    target.removeEventListener('keydown', listener);
    return handled;
  }

  it('runs the matching command and prevents the default action', () => {
    const event = key({ key: 'Delete' });
    expect(dispatchOn(window, event)).toBe(true);
    expect(ran).toEqual(['test:delete']);
    expect(event.defaultPrevented).toBe(true);
  });

  it('ignores hotkeys typed in a text field unless the command allows it', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);

    const del = key({ key: 'Delete' });
    expect(dispatchOn(input, del)).toBe(false);
    expect(del.defaultPrevented).toBe(false);

    expect(dispatchOn(input, key({ key: 's', ctrlKey: true }))).toBe(true);
    expect(ran).toEqual(['test:save']);
    input.remove();
  });

  it('ignores hotkeys in textareas, selects and contenteditable elements', () => {
    for (const element of [
      document.createElement('textarea'),
      document.createElement('select'),
    ]) {
      document.body.appendChild(element);
      expect(dispatchOn(element, key({ key: 'Delete' }))).toBe(false);
      element.remove();
    }
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    document.body.appendChild(editable);
    expect(dispatchOn(editable, key({ key: 'Delete' }))).toBe(false);
    editable.remove();
    expect(ran).toEqual([]);
  });

  it('does not run commands that cannot execute', () => {
    const event = key({ key: 'z', ctrlKey: true });
    expect(dispatchOn(window, event)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it('does nothing while a modal dialog is open', () => {
    ctx.ui.getState().open([], () => undefined);
    expect(dispatchOn(window, key({ key: 'Delete' }))).toBe(false);
    expect(ran).toEqual([]);
  });

  it('registers one window keydown listener through useHotkeys', () => {
    const hotkeyCommand: Command = {
      id: 'test:hook',
      name: 'Hook',
      hotkey: 'mod+k',
      canExec: () => true,
      exec: () => {
        ran.push('test:hook');
      },
    };
    commandRegistry[hotkeyCommand.id] = hotkeyCommand;
    try {
      renderHook(() => useHotkeys());
      window.dispatchEvent(key({ key: 'k', ctrlKey: true }));
      expect(ran).toEqual(['test:hook']);
    } finally {
      delete commandRegistry[hotkeyCommand.id];
    }
  });
});
