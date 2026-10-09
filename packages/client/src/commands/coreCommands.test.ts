import {
  createIdGen,
  findNode,
  type Selection,
  type TreeNode,
  type TreeNodeJson,
} from '@owlbt/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAlertStore } from '../store/alertStore';
import { createDialogStore } from '../store/dialogStore';
import { createProjectStore } from '../store/projectStore';
import { createTreeStore, selectCanRedo, selectCanUndo } from '../store/treeStore';
import { getContextMenuCommands } from '../components/ContextMenu/ContextMenu';
import { readClipboard } from '../lib/clipboard';
import { coreCommands, COMMAND_PALETTE_ID } from './coreCommands';
import { commandRegistry, type Command, type CommandContext } from './registry';

const PROJECT = {
  nodes: [
    { name: 'Sequence', isComposite: true, icon: 'arrow-right' },
    { name: 'Selector', isComposite: true, icon: 'arrow-down' },
    {
      name: 'Wait',
      icon: 'clock',
      properties: [{ name: 'duration', type: 'number', min: 0, default: 100 }],
    },
    { name: 'Walk', icon: 'walking' },
  ],
  decorators: [{ name: 'Inverter', icon: 'rotate' }],
  services: [{ name: 'Logger', icon: 'file' }],
};

const TREE: TreeNodeJson = {
  type: 'Sequence',
  label: 'Root',
  childNodes: [
    {
      type: 'Wait',
      label: 'Pause',
      properties: [{ name: 'duration', value: 500 }],
      decorators: [{ type: 'Inverter', inverseCheckCondition: true }],
    },
    { type: 'Missing' },
  ],
  services: [{ type: 'Logger', label: 'log' }],
};

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function cmd(id: string): Command {
  const command = coreCommands.find((c) => c.id === id);
  if (!command) {
    throw new Error(`no command ${id}`);
  }
  return command;
}

function mustRoot(ctx: CommandContext): TreeNode {
  const root = ctx.tree.getState().root;
  if (!root) {
    throw new Error('tree not loaded');
  }
  return root;
}

function mustNode(ctx: CommandContext, id: string): TreeNode {
  const node = findNode(mustRoot(ctx), id);
  if (!node) {
    throw new Error(`no node ${id}`);
  }
  return node;
}

function openItemIds(ctx: CommandContext): string[] {
  return (ctx.ui.getState().current?.items ?? []).map((item) => item.id);
}

async function setup(tree: TreeNodeJson = TREE, project: object = PROJECT): Promise<CommandContext> {
  const projectStore = createProjectStore({
    fetchProject: async () => JSON.stringify(project),
    createSocket: () => ({ on: () => undefined, disconnect: () => undefined }),
  });
  const ctx: CommandContext = {
    tree: createTreeStore({
      fetchTree: async () => structuredClone(tree),
      saveTree: async () => undefined,
      idGen: createIdGen('t'),
    }),
    project: projectStore,
    alerts: createAlertStore(),
    ui: createDialogStore(projectStore),
  };
  await ctx.tree.getState().load('tree.json');
  await ctx.project.getState().load('tree.json');
  return ctx;
}

function select(ctx: CommandContext, selection: Selection | undefined): void {
  ctx.tree.getState().select(selection);
}

describe('core command registration', () => {
  it('registers every core command in the registry with its hotkey and context menu order', () => {
    for (const command of coreCommands) {
      expect(commandRegistry[command.id]).toBe(command);
    }
    expect(cmd('core:Add').hotkey).toBe('ins');
    expect(cmd('core:Remove').hotkey).toBe('del');
    expect(cmd('core:Copy').hotkey).toBe('mod+c');
    expect(cmd('core:Paste').hotkey).toBe('mod+v');
    expect(cmd('core:MoveLeft').hotkey).toBe('shift+left');
    expect(cmd('core:MoveUp').hotkey).toBe('shift+up');
    expect(cmd('core:SelectBelow').hotkey).toBe('down');
    expect(cmd('core:Save').allowInInput).toBe(true);
    expect(cmd(COMMAND_PALETTE_ID).hotkey).toBe('mod+shift+p');
    expect(cmd(COMMAND_PALETTE_ID).allowInInput).toBe(true);
  });

  it('lists context menu commands by order and only those that can execute', async () => {
    const ctx = await setup();
    select(ctx, { kind: 'node', nodeId: mustRoot(ctx).childNodes[0].id });
    // Wait is the first child: Move Left and Paste (empty clipboard) cannot run.
    expect(getContextMenuCommands(ctx).map((c) => c.id)).toEqual([
      'core:Add',
      'core:MoveRight',
      'core:Copy',
      'core:Remove',
      'core:SetNodeType',
    ]);
  });
});

describe('Add', () => {
  it('cannot run without a selection', async () => {
    const ctx = await setup();
    expect(cmd('core:Add').canExec(ctx)).toBe(false);
  });

  it('opens a dialog with nodes, decorators and services for a composite node', async () => {
    const ctx = await setup();
    const root = mustRoot(ctx);
    select(ctx, { kind: 'node', nodeId: root.id });
    cmd('core:Add').exec(ctx);
    expect(openItemIds(ctx)).toEqual([
      'dec:Inverter',
      'node:Selector',
      'node:Sequence',
      'node:Wait',
      'node:Walk',
      'svc:Logger',
    ]);
  });

  it('offers only decorators and services for an action node', async () => {
    const ctx = await setup();
    const wait = mustRoot(ctx).childNodes[0];
    select(ctx, { kind: 'node', nodeId: wait.id });
    cmd('core:Add').exec(ctx);
    expect(openItemIds(ctx)).toEqual(['dec:Inverter', 'svc:Logger']);
  });

  it('appends the accepted node at the end and keeps the selection', async () => {
    const ctx = await setup();
    const root = mustRoot(ctx);
    select(ctx, { kind: 'node', nodeId: root.id });
    cmd('core:Add').exec(ctx);
    ctx.ui.getState().accept('node:Wait');

    const updated = mustRoot(ctx);
    expect(updated.childNodes.map((n) => n.type)).toEqual(['Wait', 'Missing', 'Wait']);
    expect(updated.childNodes[2].properties).toEqual({});
    expect(ctx.tree.getState().selection).toEqual({ kind: 'node', nodeId: root.id });

    ctx.tree.getState().undo();
    expect(mustRoot(ctx).childNodes.map((n) => n.type)).toEqual(['Wait', 'Missing']);
  });

  it('adds a decorator to the node of the selected sub item', async () => {
    const ctx = await setup();
    const wait = mustRoot(ctx).childNodes[0];
    const decorator = wait.decorators[0];
    select(ctx, { kind: 'decorator', nodeId: wait.id, itemId: decorator.id });
    cmd('core:Add').exec(ctx);
    ctx.ui.getState().accept('dec:Inverter');

    const decorators = mustNode(ctx, wait.id).decorators;
    expect(decorators.map((d) => d.type)).toEqual(['Inverter', 'Inverter']);
    expect(decorators[1].properties).toEqual({});
  });

  it('is disabled when the project is not loaded', async () => {
    const ctx = await setup();
    select(ctx, { kind: 'node', nodeId: mustRoot(ctx).id });
    const empty = { ...ctx, project: createProjectStore() };
    expect(cmd('core:Add').canExec(empty)).toBe(false);
  });
});

describe('Remove', () => {
  it('cannot remove the root node', async () => {
    const ctx = await setup();
    select(ctx, { kind: 'node', nodeId: mustRoot(ctx).id });
    expect(cmd('core:Remove').canExec(ctx)).toBe(false);
  });

  it('removes a node, selects the item above and restores both on undo', async () => {
    const ctx = await setup();
    const root = mustRoot(ctx);
    const missing = root.childNodes[1];
    select(ctx, { kind: 'node', nodeId: missing.id });
    cmd('core:Remove').exec(ctx);

    expect(mustRoot(ctx).childNodes.map((n) => n.type)).toEqual(['Wait']);
    // The item above the first child is the root's last service.
    expect(ctx.tree.getState().selection).toEqual({
      kind: 'service',
      nodeId: root.id,
      itemId: root.services[0].id,
    });

    ctx.tree.getState().undo();
    expect(mustRoot(ctx).childNodes.map((n) => n.type)).toEqual(['Wait', 'Missing']);
    expect(ctx.tree.getState().selection).toEqual({ kind: 'node', nodeId: missing.id });
  });

  it('removes a decorator and selects its node', async () => {
    const ctx = await setup();
    const wait = mustRoot(ctx).childNodes[0];
    select(ctx, { kind: 'decorator', nodeId: wait.id, itemId: wait.decorators[0].id });
    cmd('core:Remove').exec(ctx);
    expect(mustNode(ctx, wait.id).decorators).toHaveLength(0);
    expect(ctx.tree.getState().selection).toEqual({ kind: 'node', nodeId: wait.id });
  });
});

describe('Move', () => {
  it('moves nodes left and right within their siblings, not past the bounds', async () => {
    const ctx = await setup();
    const wait = mustRoot(ctx).childNodes[0];
    select(ctx, { kind: 'node', nodeId: wait.id });
    expect(cmd('core:MoveLeft').canExec(ctx)).toBe(false);
    expect(cmd('core:MoveRight').canExec(ctx)).toBe(true);

    cmd('core:MoveRight').exec(ctx);
    expect(mustRoot(ctx).childNodes.map((n) => n.type)).toEqual(['Missing', 'Wait']);
    expect(ctx.tree.getState().selection).toEqual({ kind: 'node', nodeId: wait.id });
  });

  it('moves sub items up and down, and only sub items', async () => {
    const ctx = await setup();
    const wait = mustRoot(ctx).childNodes[0];
    select(ctx, { kind: 'node', nodeId: wait.id });
    cmd('core:Add').exec(ctx);
    ctx.ui.getState().accept('dec:Inverter');

    const [first, second] = mustNode(ctx, wait.id).decorators;
    select(ctx, { kind: 'decorator', nodeId: wait.id, itemId: first.id });
    expect(cmd('core:MoveUp').canExec(ctx)).toBe(false);
    expect(cmd('core:MoveDown').canExec(ctx)).toBe(true);

    select(ctx, { kind: 'decorator', nodeId: wait.id, itemId: second.id });
    expect(cmd('core:MoveUp').canExec(ctx)).toBe(true);
    cmd('core:MoveUp').exec(ctx);
    expect(mustNode(ctx, wait.id).decorators.map((d) => d.id)).toEqual([second.id, first.id]);

    select(ctx, { kind: 'node', nodeId: wait.id });
    expect(cmd('core:MoveUp').canExec(ctx)).toBe(false);
  });
});

describe('Select', () => {
  it('moves the selection in visual order and focuses the node', async () => {
    const ctx = await setup();
    const root = mustRoot(ctx);
    select(ctx, undefined);

    cmd('core:SelectBelow').exec(ctx);
    expect(ctx.tree.getState().selection).toEqual({ kind: 'node', nodeId: root.id });

    cmd('core:SelectBelow').exec(ctx);
    expect(ctx.tree.getState().selection).toEqual({
      kind: 'service',
      nodeId: root.id,
      itemId: root.services[0].id,
    });

    select(ctx, { kind: 'node', nodeId: root.childNodes[0].id });
    cmd('core:SelectRight').exec(ctx);
    expect(ctx.tree.getState().selection).toEqual({ kind: 'node', nodeId: root.childNodes[1].id });
    expect(cmd('core:SelectRight').canExec(ctx)).toBe(false);
  });
});

describe('Copy and Paste', () => {
  it('copies a node without touching the undo stack and pastes it as the last child', async () => {
    const ctx = await setup();
    const root = mustRoot(ctx);
    const wait = root.childNodes[0];
    select(ctx, { kind: 'node', nodeId: wait.id });
    cmd('core:Copy').exec(ctx);
    expect(ctx.tree.getState().undoStack).toHaveLength(0);
    expect(readClipboard()?.itemType).toBe('node');

    select(ctx, { kind: 'node', nodeId: root.id });
    expect(cmd('core:Paste').canExec(ctx)).toBe(true);
    cmd('core:Paste').exec(ctx);

    const pasted = mustRoot(ctx).childNodes[2];
    expect(pasted.type).toBe('Wait');
    expect(pasted.id).not.toBe(wait.id);
    expect(pasted.properties).toEqual({ duration: 500 });
    expect(pasted.decorators[0].type).toBe('Inverter');
    expect(ctx.tree.getState().selection).toEqual({ kind: 'node', nodeId: pasted.id });
  });

  it('does not paste a node onto a leaf node', async () => {
    const ctx = await setup();
    const root = mustRoot(ctx);
    select(ctx, { kind: 'node', nodeId: root.id });
    cmd('core:Copy').exec(ctx);
    select(ctx, { kind: 'node', nodeId: root.childNodes[0].id });
    expect(cmd('core:Paste').canExec(ctx)).toBe(false);
  });

  it('pastes a decorator after the selected decorator of the same kind', async () => {
    const ctx = await setup();
    const wait = mustRoot(ctx).childNodes[0];
    const original = wait.decorators[0];
    select(ctx, { kind: 'decorator', nodeId: wait.id, itemId: original.id });
    cmd('core:Copy').exec(ctx);

    cmd('core:Paste').exec(ctx);
    const after = mustNode(ctx, wait.id).decorators;
    expect(after).toHaveLength(2);
    expect(after[0].id).toBe(original.id);
    expect(ctx.tree.getState().selection).toEqual({
      kind: 'decorator',
      nodeId: wait.id,
      itemId: after[1].id,
    });
  });

  it('appends a sub item at the end when the selected item is of another kind', async () => {
    const ctx = await setup();
    const root = mustRoot(ctx);
    const wait = root.childNodes[0];
    select(ctx, { kind: 'service', nodeId: root.id, itemId: root.services[0].id });
    cmd('core:Copy').exec(ctx);

    select(ctx, { kind: 'decorator', nodeId: wait.id, itemId: wait.decorators[0].id });
    cmd('core:Paste').exec(ctx);

    const updated = mustNode(ctx, wait.id);
    expect(updated.decorators.map((d) => d.type)).toEqual(['Inverter']);
    expect(updated.services.map((s) => s.type)).toEqual(['Logger']);
  });

  it('is disabled with an empty clipboard', async () => {
    const ctx = await setup();
    select(ctx, { kind: 'node', nodeId: mustRoot(ctx).id });
    window.localStorage.clear();
    expect(cmd('core:Paste').canExec(ctx)).toBe(false);
  });
});

describe('Set Node Type', () => {
  it('is only available for nodes', async () => {
    const ctx = await setup();
    const wait = mustRoot(ctx).childNodes[0];
    select(ctx, { kind: 'decorator', nodeId: wait.id, itemId: wait.decorators[0].id });
    expect(cmd('core:SetNodeType').canExec(ctx)).toBe(false);
  });

  it('offers same-kind types only and drops properties the new type does not declare', async () => {
    const ctx = await setup();
    const wait = mustRoot(ctx).childNodes[0];
    select(ctx, { kind: 'node', nodeId: wait.id });
    cmd('core:SetNodeType').exec(ctx);
    expect(openItemIds(ctx)).toEqual(['node:Walk']);

    ctx.ui.getState().accept('node:Walk');
    const changed = mustNode(ctx, wait.id);
    expect(changed.type).toBe('Walk');
    expect(changed.properties).toEqual({});

    ctx.tree.getState().undo();
    const restored = mustNode(ctx, wait.id);
    expect(restored.type).toBe('Wait');
    expect(restored.properties).toEqual({ duration: 500 });
  });

  it('offers other composite types for a composite node', async () => {
    const ctx = await setup();
    select(ctx, { kind: 'node', nodeId: mustRoot(ctx).id });
    cmd('core:SetNodeType').exec(ctx);
    expect(openItemIds(ctx)).toEqual(['node:Selector']);
  });
});

describe('Undo, Redo and Save', () => {
  it('reports undo and redo availability and reverts/reapplies edits', async () => {
    const ctx = await setup();
    select(ctx, { kind: 'node', nodeId: mustRoot(ctx).childNodes[1].id });
    cmd('core:Remove').exec(ctx);
    expect(cmd('core:Undo').canExec(ctx)).toBe(true);
    expect(selectCanRedo(ctx.tree.getState())).toBe(false);

    cmd('core:Undo').exec(ctx);
    expect(selectCanUndo(ctx.tree.getState())).toBe(false);
    expect(cmd('core:Redo').canExec(ctx)).toBe(true);

    cmd('core:Redo').exec(ctx);
    expect(mustRoot(ctx).childNodes).toHaveLength(1);
  });

  it('saves a valid tree without asking', async () => {
    // TREE contains a 'Missing' node, which is invalid; keep only the valid part.
    const ctx = await setup({ ...TREE, childNodes: [TREE.childNodes![0]] });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const save = vi.spyOn(ctx.tree.getState(), 'save');
    await cmd('core:Save').exec(ctx);
    expect(confirm).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
    confirm.mockRestore();
  });

  it('asks before saving an invalid tree and saves only when confirmed', async () => {
    const invalid: TreeNodeJson = {
      ...TREE,
      childNodes: [{ type: 'Wait', properties: [{ name: 'duration', value: -5 }] }],
    };
    const ctx = await setup(invalid);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const save = vi.spyOn(ctx.tree.getState(), 'save');

    await cmd('core:Save').exec(ctx);
    expect(confirm).toHaveBeenCalledWith('Tree contains invalid items. Save anyway?');
    expect(save).not.toHaveBeenCalled();

    await cmd('core:Save').exec(ctx);
    expect(save).toHaveBeenCalledTimes(1);
    confirm.mockRestore();
  });
});

describe('Command Palette', () => {
  it('lists the executable commands sorted by name with their hotkeys', async () => {
    const ctx = await setup();
    select(ctx, { kind: 'node', nodeId: mustRoot(ctx).childNodes[0].id });
    cmd(COMMAND_PALETTE_ID).exec(ctx);

    const items = ctx.ui.getState().current?.items ?? [];
    const names = items.map((item) => item.name);
    expect(names).toContain('Add');
    expect(names).not.toContain('Undo');
    expect(names).not.toContain('Command Palette');
    expect([...names].sort((a, b) => (a < b ? -1 : 1))).toEqual(names);
    expect(items.find((item) => item.name === 'Add')?.hint).toBe('ins');
  });

  it('runs the accepted command', async () => {
    const ctx = await setup();
    const missing = mustRoot(ctx).childNodes[1];
    select(ctx, { kind: 'node', nodeId: missing.id });
    cmd(COMMAND_PALETTE_ID).exec(ctx);
    ctx.ui.getState().accept('core:Remove');
    expect(mustRoot(ctx).childNodes.map((n) => n.type)).toEqual(['Wait']);
  });
});

describe('Dialogs and project reloads', () => {
  it('closes an open dialog when the project reloads', async () => {
    const ctx = await setup();
    select(ctx, { kind: 'node', nodeId: mustRoot(ctx).id });
    cmd('core:Add').exec(ctx);
    expect(ctx.ui.getState().current).toBeDefined();

    ctx.project.getState().applyContent(JSON.stringify(PROJECT));
    expect(ctx.ui.getState().current).toBeUndefined();
  });
});

