import { createIdGen, nodeFromJson, type TreeNodeJson } from '@owlbt/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createAlertStore } from '../store/alertStore';
import { collapseStore } from '../store/collapseStore';
import { createDialogStore } from '../store/dialogStore';
import { createProjectStore } from '../store/projectStore';
import { searchStore } from '../store/searchStore';
import { createTreeStore } from '../store/treeStore';
import { coreCommands } from './coreCommands';
import type { CommandContext } from './registry';
import { handleHotkey, matchesHotkey } from './useHotkeys';
import { VIEW_COMMAND_IDS, viewCommands } from './viewCommands';

const TREE: TreeNodeJson = {
  type: 'Sequence',
  childNodes: [{ type: 'Sequence', childNodes: [{ type: 'Wait' }] }, { type: 'Wait' }],
};

function makeContext(): CommandContext {
  const project = createProjectStore();
  const tree = createTreeStore();
  tree.setState({ root: nodeFromJson(structuredClone(TREE), createIdGen('v')) });
  return { tree, project, alerts: createAlertStore(), ui: createDialogStore(project) };
}

function cmd(id: string) {
  const command = viewCommands.find((c) => c.id === id);
  if (!command) {
    throw new Error(`no command ${id}`);
  }
  return command;
}

function key(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
}

describe('view commands', () => {
  let ctx: CommandContext;

  beforeEach(() => {
    ctx = makeContext();
    collapseStore.getState().set([]);
    searchStore.setState({ open: false, query: '', index: -1 });
  });

  it('do not reuse hotkeys of other commands', () => {
    const used = coreCommands.map((c) => c.hotkey).filter((h) => h !== undefined);
    for (const command of viewCommands) {
      if (command.hotkey !== undefined) {
        expect(used).not.toContain(command.hotkey);
      }
    }
  });

  it('toggles the selected node with children', () => {
    const toggle = cmd(VIEW_COMMAND_IDS.toggleCollapse);
    const root = ctx.tree.getState().root!;
    expect(toggle.canExec(ctx)).toBe(false);

    ctx.tree.getState().select({ kind: 'node', nodeId: root.childNodes[1].id });
    expect(toggle.canExec(ctx)).toBe(false);

    const group = root.childNodes[0];
    ctx.tree.getState().select({ kind: 'node', nodeId: group.id });
    expect(toggle.canExec(ctx)).toBe(true);
    void toggle.exec(ctx);
    expect(collapseStore.getState().collapsed.has(group.id)).toBe(true);
    void toggle.exec(ctx);
    expect(collapseStore.getState().collapsed.has(group.id)).toBe(false);
  });

  it('collapses all but the root and expands all', () => {
    const collapseAll = cmd(VIEW_COMMAND_IDS.collapseAll);
    const expandAll = cmd(VIEW_COMMAND_IDS.expandAll);
    const root = ctx.tree.getState().root!;
    expect(expandAll.canExec(ctx)).toBe(false);

    void collapseAll.exec(ctx);
    expect([...collapseStore.getState().collapsed]).toEqual([root.childNodes[0].id]);
    expect(collapseAll.canExec(ctx)).toBe(false);
    expect(expandAll.canExec(ctx)).toBe(true);

    void expandAll.exec(ctx);
    expect(collapseStore.getState().collapsed.size).toBe(0);
  });

  it('opens and closes the find box with Ctrl+F and Escape', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const ctrlF = key({ key: 'f', ctrlKey: true });
    input.dispatchEvent(ctrlF);
    // Ctrl+F also works from text fields.
    expect(handleHotkey(ctrlF, viewCommands, ctx)).toBe(true);
    expect(ctrlF.defaultPrevented).toBe(true);
    expect(searchStore.getState().open).toBe(true);

    expect(handleHotkey(key({ key: 'Escape' }), viewCommands, ctx)).toBe(true);
    expect(searchStore.getState().open).toBe(false);
    expect(handleHotkey(key({ key: 'Escape' }), viewCommands, ctx)).toBe(false);
    input.remove();
  });

  it('maps space and leaves Space on focused buttons alone', () => {
    expect(matchesHotkey(key({ key: ' ' }), 'space')).toBe(true);
    const root = ctx.tree.getState().root!;
    ctx.tree.getState().select({ kind: 'node', nodeId: root.id });

    const button = document.createElement('button');
    document.body.appendChild(button);
    const onButton = key({ key: ' ' });
    button.dispatchEvent(onButton);
    expect(handleHotkey(onButton, viewCommands, ctx)).toBe(false);
    button.remove();

    expect(handleHotkey(key({ key: ' ' }), viewCommands, ctx)).toBe(true);
    expect(collapseStore.getState().collapsed.has(root.id)).toBe(true);
  });
});
