import { findNode, isCollapsedNode } from '@owlbt/shared';
import { collapseAllIds, collapseStore } from '../store/collapseStore';
import { searchStore } from '../store/searchStore';
import { registerCommand, type Command, type CommandContext } from './registry';
import { t } from '../i18n';

/**
 * Tree view commands: collapse / expand subtrees and find. They change view state only, so they
 * also work in run mode (where the tree is read-only).
 */

export const VIEW_COMMAND_IDS = {
  toggleCollapse: 'core:ToggleCollapse',
  collapseAll: 'core:CollapseAll',
  expandAll: 'core:ExpandAll',
  find: 'core:Find',
  closeFind: 'core:CloseFind',
} as const;

/** The selected node (also for a selected decorator / service) when it has children. */
function selectedParent(ctx: CommandContext) {
  const { root, selection } = ctx.tree.getState();
  if (!root || !selection) {
    return undefined;
  }
  const node = findNode(root, selection.nodeId);
  return node && node.childNodes.length > 0 ? node : undefined;
}

const toggleCollapse: Command = {
  id: VIEW_COMMAND_IDS.toggleCollapse,
  name: t('Collapse / Expand Subtree'),
  hotkey: 'space',
  contextMenuOrder: 150,
  canExec(ctx) {
    return selectedParent(ctx) !== undefined;
  },
  exec(ctx) {
    const node = selectedParent(ctx);
    if (node) {
      collapseStore.getState().toggle(node.id);
    }
  },
};

const collapseAll: Command = {
  id: VIEW_COMMAND_IDS.collapseAll,
  name: t('Collapse All'),
  canExec(ctx) {
    const root = ctx.tree.getState().root;
    if (!root) {
      return false;
    }
    const collapsed = collapseStore.getState().collapsed;
    return collapseAllIds(root).some((id) => !collapsed.has(id));
  },
  exec(ctx) {
    const root = ctx.tree.getState().root;
    if (root) {
      collapseStore.getState().set(collapseAllIds(root));
    }
  },
};

const expandAll: Command = {
  id: VIEW_COMMAND_IDS.expandAll,
  name: t('Expand All'),
  canExec(ctx) {
    const root = ctx.tree.getState().root;
    if (!root) {
      return false;
    }
    const collapsed = collapseStore.getState().collapsed;
    return [...collapsed].some((id) => {
      const node = findNode(root, id);
      return node !== undefined && isCollapsedNode(node, collapsed);
    });
  },
  exec() {
    collapseStore.getState().set([]);
  },
};

const find: Command = {
  id: VIEW_COMMAND_IDS.find,
  name: t('Find in Tree'),
  hotkey: 'mod+f',
  allowInInput: true,
  canExec(ctx) {
    return ctx.tree.getState().root !== undefined;
  },
  exec() {
    searchStore.getState().show();
  },
};

const closeFind: Command = {
  id: VIEW_COMMAND_IDS.closeFind,
  name: t('Close Find'),
  hotkey: 'esc',
  canExec() {
    return searchStore.getState().open;
  },
  exec() {
    searchStore.getState().close();
  },
};

export const viewCommands: Command[] = [toggleCollapse, collapseAll, expandAll, find, closeFind];

for (const command of viewCommands) {
  registerCommand(command);
}
