import { findNode, isSubtreeLoaded, subtreeRefOf, type TreeNode } from '@owlbt/shared';
import { navigateTo } from '../lib/appNavigation';
import { alerts } from '../store/alertStore';
import { runStore } from '../store/runStore';
import { subtreeStore, type SubtreeState } from '../store/subtreeStore';
import type { TreeStore } from '../store/treeStore';
import { registerCommand, type Command, type CommandContext } from './registry';
import { t } from '../i18n';

export const OPEN_SUBTREE_COMMAND_ID = 'core:OpenSubtree';

/** Absolute path of a project-relative reference, with the separator style of the project folder. */
export function subtreeFilePath(projectDir: string, ref: string): string {
  const windows = projectDir.includes('\\') && !projectDir.includes('/');
  const base = projectDir.replace(/[\\/]+$/, '');
  return `${base}${windows ? '\\' : '/'}${windows ? ref.replace(/\//g, '\\') : ref}`;
}

export interface SubtreeTarget {
  /** Normalized project-relative reference. */
  ref: string;
  /** Absolute path of the referenced file (the loaded one when known). */
  path?: string;
  /** False when the file is missing or invalid. */
  loaded: boolean;
}

/** Where a subtree node of the open tree points to; undefined for other nodes and empty references. */
export function subtreeTargetOf(
  node: TreeNode | undefined,
  ctx: Pick<CommandContext, 'project'>,
  state: Pick<SubtreeState, 'library' | 'projectDir'> = subtreeStore.getState(),
): SubtreeTarget | undefined {
  const project = ctx.project.getState().project;
  if (!node || !project) {
    return undefined;
  }
  const result = subtreeRefOf(node, project);
  if (!result || !('ref' in result)) {
    return undefined;
  }
  const entry = state.library[result.ref];
  const path = isSubtreeLoaded(entry)
    ? entry.path
    : state.projectDir !== undefined
      ? subtreeFilePath(state.projectDir, result.ref)
      : undefined;
  return { ref: result.ref, path, loaded: isSubtreeLoaded(entry) };
}

function selectedNode(ctx: CommandContext): TreeNode | undefined {
  const { root, selection } = ctx.tree.getState();
  return root && selection ? findNode(root, selection.nodeId) : undefined;
}

/** Editor URL of a tree file. */
export function treeEditorUrl(treePath: string): string {
  return `/tree?${new URLSearchParams({ path: treePath }).toString()}`;
}

/**
 * Opens a referenced tree in an editor tab (an already open tab is activated). The open tree keeps
 * its unsaved changes in its own tab.
 */
export async function openSubtreeFile(_tree: TreeStore, target: SubtreeTarget): Promise<boolean> {
  if (!target.loaded || target.path === undefined) {
    alerts.error(
      t("Referenced tree '{ref}' cannot be opened: the file is missing or invalid", {
        ref: target.ref,
      }),
    );
    return false;
  }
  navigateTo(treeEditorUrl(target.path));
  return true;
}

/** Opens the tree referenced by a node of the open tree (double-click on a subtree node). */
export function openSubtreeOfNode(ctx: CommandContext, nodeId: string): Promise<boolean> {
  const { root } = ctx.tree.getState();
  const target = subtreeTargetOf(root ? findNode(root, nodeId) : undefined, ctx);
  return target ? openSubtreeFile(ctx.tree, target) : Promise.resolve(false);
}

const openSubtree: Command = {
  id: OPEN_SUBTREE_COMMAND_ID,
  name: t('Open referenced tree'),
  hotkey: 'mod+enter',
  contextMenuOrder: 50,
  canExec(ctx) {
    const selection = ctx.tree.getState().selection;
    return (
      !runStore.getState().active &&
      selection?.kind === 'node' &&
      subtreeTargetOf(selectedNode(ctx), ctx) !== undefined
    );
  },
  async exec(ctx) {
    const target = subtreeTargetOf(selectedNode(ctx), ctx);
    if (target) {
      await openSubtreeFile(ctx.tree, target);
    }
  },
};

export const subtreeCommands: Command[] = [openSubtree];

for (const command of subtreeCommands) {
  registerCommand(command);
}
