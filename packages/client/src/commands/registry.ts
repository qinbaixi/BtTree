import { alertStore, type AlertStore } from '../store/alertStore';
import { dialogStore, type DialogStore } from '../store/dialogStore';
import { projectStore, type ProjectStore } from '../store/projectStore';
import { treeStore, type TreeStore } from '../store/treeStore';

/**
 * Stores a command can read and act on. The current selection is read from `tree`.
 * `ui` opens the modal list dialogs (Add, Set Node Type, Command Palette).
 */
export interface CommandContext {
  readonly tree: TreeStore;
  readonly project: ProjectStore;
  readonly alerts: AlertStore;
  readonly ui: DialogStore;
}

export interface Command {
  /** Stable id, e.g. 'core:Save'. Menus refer to commands by id. */
  id: string;
  name: string;
  hotkey?: string;
  allowInInput?: boolean;
  contextMenuOrder?: number;
  canExec(ctx: CommandContext): boolean;
  exec(ctx: CommandContext): void | Promise<void>;
}

/** Commands by id. Phase 5 registers the concrete commands here. */
export const commandRegistry: Record<string, Command> = {};

export function registerCommand(command: Command): void {
  commandRegistry[command.id] = command;
}

export function getCommand(id: string): Command | undefined {
  return commandRegistry[id];
}

export const commandContext: CommandContext = {
  tree: treeStore,
  project: projectStore,
  alerts: alertStore,
  ui: dialogStore,
};

/** Runs a command by id if it is registered and can execute in the current state. */
export async function execCommand(id: string): Promise<void> {
  const command = getCommand(id);
  if (command && command.canExec(commandContext)) {
    await command.exec(commandContext);
  }
}
