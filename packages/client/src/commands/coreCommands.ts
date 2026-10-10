import {
  addChildNode,
  addSubItem,
  findNode,
  findParent,
  getItemType,
  getSubItems,
  itemAbove,
  moveNode,
  moveSubItem,
  nodeFromJson,
  nodeToJson,
  navigate,
  removeNode,
  removeSubItem,
  setNodeType,
  subItemFromJson,
  subItemToJson,
  type NavDirection,
  type Selection,
  type SubItemKind,
  type TreeNode,
} from '@owlbt/shared';
import { focusNode } from '../components/TreeCanvas/viewportStore';
import { exportTree, type ExportFormat, type ExportTreeResult } from '../lib/api';
import { readClipboard, writeClipboard } from '../lib/clipboard';
import { setTheme, type ThemeId } from '../lib/theme';
import type { FuzzyItem } from '../store/dialogStore';
import { getSelectedItem, selectCanRedo, selectCanUndo } from '../store/treeStore';
import {
  addItemToNode,
  choiceId,
  compareStrings,
  isCompositeNode,
  listAddableChoices,
  listNodeChoices,
  type ItemChoice,
} from './itemTypes';
import { commandRegistry, registerCommand, type Command, type CommandContext } from './registry';
import { formatHotkey } from './useHotkeys';

export const COMMAND_PALETTE_ID = 'core:CommandPalette';

function currentTarget(ctx: CommandContext) {
  const { root, selection } = ctx.tree.getState();
  return getSelectedItem(root, selection);
}

/** Structural equality of two selections (undefined only equals undefined). */
function sameSelection(a: Selection | undefined, b: Selection | undefined): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  if (a.kind === 'node') {
    return b.kind === 'node' && a.nodeId === b.nodeId;
  }
  return b.kind !== 'node' && b.kind === a.kind && b.nodeId === a.nodeId && b.itemId === a.itemId;
}

function indexOfNode(node: TreeNode, id: string): number {
  return node.childNodes.findIndex((child) => child.id === id);
}

function canMoveInList(index: number, length: number, delta: -1 | 1): boolean {
  const target = index + delta;
  return index >= 0 && target >= 0 && target < length;
}

function canMoveNode(root: TreeNode, id: string, delta: -1 | 1): boolean {
  const parent = findParent(root, id);
  if (!parent) {
    return false;
  }
  return canMoveInList(indexOfNode(parent, id), parent.childNodes.length, delta);
}

function canMoveSubItem(
  root: TreeNode,
  nodeId: string,
  kind: SubItemKind,
  itemId: string,
  delta: -1 | 1,
): boolean {
  const node = findNode(root, nodeId);
  if (!node) {
    return false;
  }
  const items = getSubItems(node, kind);
  return canMoveInList(
    items.findIndex((item) => item.id === itemId),
    items.length,
    delta,
  );
}

function choiceItem(choice: ItemChoice): FuzzyItem {
  return {
    id: choiceId(choice.itemType, choice.type.name),
    name: choiceId(choice.itemType, choice.type.name),
    icon: choice.type.icon,
    color: choice.type.color,
  };
}

function findChoice(choices: ItemChoice[], id: string): ItemChoice | undefined {
  return choices.find((choice) => choiceId(choice.itemType, choice.type.name) === id);
}

const add: Command = {
  id: 'core:Add',
  name: 'Add',
  hotkey: 'ins',
  contextMenuOrder: 100,
  canExec(ctx) {
    return currentTarget(ctx) !== undefined && ctx.project.getState().project !== undefined;
  },
  exec(ctx) {
    const target = currentTarget(ctx);
    const project = ctx.project.getState().project;
    if (!target || !project) {
      return;
    }
    const nodeId = target.node.id;
    const choices = listAddableChoices(project, target.node);
    ctx.ui.getState().open(choices.map(choiceItem), (id) => {
      const choice = findChoice(choices, id);
      if (choice) {
        addItemToNode(ctx.tree, nodeId, choice.itemType, choice.type.name);
      }
    });
  },
};

const remove: Command = {
  id: 'core:Remove',
  name: 'Remove',
  hotkey: 'del',
  contextMenuOrder: 300,
  canExec(ctx) {
    const { root, selection } = ctx.tree.getState();
    if (!root || !selection || getSelectedItem(root, selection) === undefined) {
      return false;
    }
    return !(selection.kind === 'node' && selection.nodeId === root.id);
  },
  exec(ctx) {
    const { root, selection } = ctx.tree.getState();
    if (!root || !selection) {
      return;
    }
    const target = getSelectedItem(root, selection);
    if (!target || (selection.kind === 'node' && selection.nodeId === root.id)) {
      return;
    }
    const name = target.subItem?.type ?? target.node.type;
    // The item above becomes selected; it is never inside the removed subtree.
    const after: Selection = itemAbove(root, selection) ?? { kind: 'node', nodeId: root.id };

    ctx.tree.getState().apply(
      `Remove ${name}`,
      (draft) => {
        if (selection.kind === 'node') {
          removeNode(draft, selection.nodeId);
          return;
        }
        const node = findNode(draft, selection.nodeId);
        if (node) {
          removeSubItem(node, selection.kind, selection.itemId);
        }
      },
      after,
    );
  },
};

const copy: Command = {
  id: 'core:Copy',
  name: 'Copy',
  hotkey: 'mod+c',
  contextMenuOrder: 200,
  canExec(ctx) {
    return currentTarget(ctx) !== undefined;
  },
  exec(ctx) {
    const target = currentTarget(ctx);
    if (!target) {
      return;
    }
    if (target.kind === 'node') {
      writeClipboard({ itemType: 'node', item: nodeToJson(target.node) });
    } else if (target.subItem) {
      writeClipboard({ itemType: target.kind, item: subItemToJson(target.subItem) });
    }
  },
};

const paste: Command = {
  id: 'core:Paste',
  name: 'Paste',
  hotkey: 'mod+v',
  contextMenuOrder: 201,
  canExec(ctx) {
    const target = currentTarget(ctx);
    const clip = readClipboard();
    if (!target || !clip) {
      return false;
    }
    return clip.itemType !== 'node' || isCompositeNode(ctx.project.getState().project, target.node);
  },
  exec(ctx) {
    const target = currentTarget(ctx);
    const clip = readClipboard();
    if (!target || !clip) {
      return;
    }
    const tree = ctx.tree.getState();
    const idGen = tree.getIdGen();
    const nodeId = target.node.id;

    if (clip.itemType === 'node') {
      // Nodes are only pasted as the last child of a composite node.
      const created = nodeFromJson(clip.item, idGen);
      tree.apply(
        'Paste',
        (draft) => {
          const node = findNode(draft, nodeId);
          if (node) {
            addChildNode(node, created);
          }
        },
        { kind: 'node', nodeId: created.id },
      );
      return;
    }

    // Decorators/services go right after the selected item of the same kind, otherwise at the end.
    const kind = clip.itemType;
    const items = getSubItems(target.node, kind);
    const selectedSub = target.subItem;
    const index =
      target.kind === kind && selectedSub
        ? items.findIndex((item) => item.id === selectedSub.id) + 1
        : undefined;
    const created = subItemFromJson(clip.item, idGen);
    tree.apply(
      'Paste',
      (draft) => {
        const node = findNode(draft, nodeId);
        if (node) {
          addSubItem(node, kind, created, index);
        }
      },
      { kind, nodeId, itemId: created.id },
    );
  },
};

const undo: Command = {
  id: 'core:Undo',
  name: 'Undo',
  hotkey: 'mod+z',
  canExec(ctx) {
    return selectCanUndo(ctx.tree.getState());
  },
  exec(ctx) {
    ctx.tree.getState().undo();
  },
};

const redo: Command = {
  id: 'core:Redo',
  name: 'Redo',
  hotkey: 'mod+y',
  canExec(ctx) {
    return selectCanRedo(ctx.tree.getState());
  },
  exec(ctx) {
    ctx.tree.getState().redo();
  },
};

const save: Command = {
  id: 'core:Save',
  name: 'Save',
  hotkey: 'mod+s',
  allowInInput: true,
  canExec(ctx) {
    return ctx.tree.getState().root !== undefined;
  },
  async exec(ctx) {
    const tree = ctx.tree.getState();
    const project = ctx.project.getState().project;
    if (project && !tree.isValid(project)) {
      if (!window.confirm('Tree contains invalid items. Save anyway?')) {
        return;
      }
    }
    await tree.save();
  },
};

function moveNodeCommand(name: string, hotkey: string, delta: -1 | 1, order: number): Command {
  return {
    id: `core:Move${delta < 0 ? 'Left' : 'Right'}`,
    name,
    hotkey,
    contextMenuOrder: order,
    canExec(ctx) {
      const { root, selection } = ctx.tree.getState();
      return (
        root !== undefined &&
        selection !== undefined &&
        selection.kind === 'node' &&
        canMoveNode(root, selection.nodeId, delta)
      );
    },
    exec(ctx) {
      const { root, selection } = ctx.tree.getState();
      if (!root || !selection || selection.kind !== 'node') {
        return;
      }
      const nodeId = selection.nodeId;
      ctx.tree.getState().apply(name, (draft) => {
        moveNode(draft, nodeId, delta);
      });
    },
  };
}

function moveSubItemCommand(name: string, hotkey: string, delta: -1 | 1, order: number): Command {
  return {
    id: `core:Move${delta < 0 ? 'Up' : 'Down'}`,
    name,
    hotkey,
    contextMenuOrder: order,
    canExec(ctx) {
      const { root, selection } = ctx.tree.getState();
      return (
        root !== undefined &&
        selection !== undefined &&
        selection.kind !== 'node' &&
        canMoveSubItem(root, selection.nodeId, selection.kind, selection.itemId, delta)
      );
    },
    exec(ctx) {
      const { root, selection } = ctx.tree.getState();
      if (!root || !selection || selection.kind === 'node') {
        return;
      }
      const { nodeId, kind, itemId } = selection;
      ctx.tree.getState().apply(name, (draft) => {
        const node = findNode(draft, nodeId);
        if (node) {
          moveSubItem(node, kind, itemId, delta);
        }
      });
    },
  };
}

function selectCommand(id: string, name: string, hotkey: string, dir: NavDirection): Command {
  return {
    id,
    name,
    hotkey,
    canExec(ctx) {
      const { root, selection } = ctx.tree.getState();
      return root !== undefined && !sameSelection(navigate(root, selection, dir), selection);
    },
    exec(ctx) {
      const { root, selection } = ctx.tree.getState();
      if (!root) {
        return;
      }
      const next = navigate(root, selection, dir);
      if (sameSelection(next, selection)) {
        return;
      }
      ctx.tree.getState().select(next);
      focusNode(next.nodeId);
    },
  };
}

const focusSelected: Command = {
  id: 'core:FocusSelected',
  name: 'Focus Selected Node',
  canExec(ctx) {
    return currentTarget(ctx) !== undefined;
  },
  exec(ctx) {
    const target = currentTarget(ctx);
    if (target) {
      focusNode(target.node.id);
    }
  },
};

const setNodeTypeCommand: Command = {
  id: 'core:SetNodeType',
  name: 'Set Node Type',
  contextMenuOrder: 300,
  canExec(ctx) {
    const target = currentTarget(ctx);
    return target?.kind === 'node' && ctx.project.getState().project !== undefined;
  },
  exec(ctx) {
    const target = currentTarget(ctx);
    const project = ctx.project.getState().project;
    if (!target || target.kind !== 'node' || !project) {
      return;
    }
    const node = target.node;
    const current = getItemType(project, 'node', node.type);
    const types = listNodeChoices(project)
      .filter(
        (choice) =>
          choice.type.isComposite === current.isComposite && choice.type.name !== node.type,
      )
      .sort((a, b) => compareStrings(a.type.name, b.type.name));
    const nodeId = node.id;

    ctx.ui.getState().open(types.map(choiceItem), (id) => {
      const choice = findChoice(types, id);
      if (!choice) {
        return;
      }
      const type = choice.type;
      ctx.tree.getState().apply('Set Node Type', (draft) => {
        const draftNode = findNode(draft, nodeId);
        if (draftNode) {
          setNodeType(draftNode, type.name, type);
        }
      });
    });
  },
};

const commandPalette: Command = {
  id: COMMAND_PALETTE_ID,
  name: 'Command Palette',
  hotkey: 'mod+shift+p',
  allowInInput: true,
  canExec(ctx) {
    return ctx.tree.getState().root !== undefined;
  },
  exec(ctx) {
    const commands = Object.values(commandRegistry)
      .filter((command) => command.id !== COMMAND_PALETTE_ID && command.canExec(ctx))
      .sort((a, b) => compareStrings(a.name, b.name));
    ctx.ui.getState().open(
      commands.map((command) => ({
        id: command.id,
        name: command.name,
        hint: formatHotkey(command.hotkey),
      })),
      (id) => {
        const command = commandRegistry[id];
        if (command && command.canExec(ctx)) {
          void command.exec(ctx);
        }
      },
    );
  },
};

export const EXPORT_COMMAND_IDS = {
  erlang: 'core:ExportErlang',
  lua: 'core:ExportLua',
  ts: 'core:ExportTs',
  cs: 'core:ExportCs',
  all: 'core:ExportAll',
} as const;

/** How long the list of written files stays on screen. */
export const EXPORT_SUCCESS_ALERT_MS = 15000;

/**
 * Exports the open tree to the given formats. Unsaved changes are saved first; the export is
 * cancelled when the user declines or the save fails. Written files, warnings and errors are shown as alerts.
 */
function exportCommand(id: string, name: string, formats: ExportFormat[]): Command {
  return {
    id,
    name,
    canExec(ctx) {
      const tree = ctx.tree.getState();
      return tree.root !== undefined && tree.treePath !== undefined;
    },
    async exec(ctx) {
      const tree = ctx.tree.getState();
      const { treePath, root } = tree;
      if (!treePath || !root) {
        return;
      }
      if (tree.dirty) {
        if (!window.confirm('Save changes before exporting?')) {
          return;
        }
        if (!(await tree.save())) {
          return;
        }
      }

      let result: ExportTreeResult;
      try {
        result = await exportTree(treePath, formats);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.alerts.getState().push('error', `Export failed: ${message}`);
        return;
      }
      const alertStore = ctx.alerts.getState();
      if (result.warnings.length > 0) {
        alertStore.push('warning', result.warnings.join('\n'));
      }
      if (result.error !== undefined) {
        alertStore.push('error', `Export failed: ${result.error}`);
      }
      if (result.files.length > 0) {
        const paths = result.files.map((file) => file.path).join('\n');
        alertStore.push('success', `Exported:\n${paths}`, {
          autoHideMs: EXPORT_SUCCESS_ALERT_MS,
        });
      }
    },
  };
}

const exportErlang = exportCommand(EXPORT_COMMAND_IDS.erlang, 'Export: Erlang', ['erlang']);
const exportLua = exportCommand(EXPORT_COMMAND_IDS.lua, 'Export: Lua', ['lua']);
const exportTs = exportCommand(EXPORT_COMMAND_IDS.ts, 'Export: TypeScript', ['ts']);
const exportCs = exportCommand(EXPORT_COMMAND_IDS.cs, 'Export: C#', ['cs']);
const exportAll = exportCommand(EXPORT_COMMAND_IDS.all, 'Export: All formats', [
  'erlang',
  'lua',
  'ts',
  'cs',
]);

export const THEME_COMMAND_IDS: Record<ThemeId, string> = {
  light: 'core:ThemeLight',
  classic: 'core:ThemeClassic',
};

/** Switches the color theme. Always executable, so they also appear in the command palette. */
function themeCommand(theme: ThemeId, name: string): Command {
  return {
    id: THEME_COMMAND_IDS[theme],
    name,
    canExec() {
      return true;
    },
    exec() {
      setTheme(theme);
    },
  };
}

const themeLight = themeCommand('light', 'Theme: Light');
const themeClassic = themeCommand('classic', 'Theme: Classic dark');

/** All core commands. Registered in the command registry when this module is loaded. */
export const coreCommands: Command[] = [
  add,
  remove,
  copy,
  paste,
  undo,
  redo,
  save,
  exportErlang,
  exportLua,
  exportTs,
  exportCs,
  exportAll,
  moveNodeCommand('Move Left', 'shift+left', -1, 100),
  moveNodeCommand('Move Right', 'shift+right', 1, 101),
  moveSubItemCommand('Move Up', 'shift+up', -1, 100),
  moveSubItemCommand('Move Down', 'shift+down', 1, 101),
  selectCommand('core:SelectAbove', 'Select Item Above', 'up', 'up'),
  selectCommand('core:SelectBelow', 'Select Item Below', 'down', 'down'),
  selectCommand('core:SelectLeft', 'Select Left Node', 'left', 'left'),
  selectCommand('core:SelectRight', 'Select Right Node', 'right', 'right'),
  focusSelected,
  setNodeTypeCommand,
  commandPalette,
  themeLight,
  themeClassic,
];

for (const command of coreCommands) {
  registerCommand(command);
}
