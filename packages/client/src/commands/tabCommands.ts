import { ApiError, fetchWorkspace, pickPath, type WorkspaceTree } from '../lib/api';
import { getPathLastSegment } from '../lib/mru';
import { samePath } from '../lib/paths';
import { alerts } from '../store/alertStore';
import { tabsStore, type TabsStore } from '../store/tabsStore';
import { flushActiveInput, matchesHotkey } from './useHotkeys';
import { commandContext, execCommand, registerCommand, type Command } from './registry';
import { t } from '../i18n';

export const TAB_COMMAND_IDS = {
  open: 'tabs:OpenTree',
  next: 'tabs:NextTab',
  previous: 'tabs:PreviousTab',
  close: 'tabs:CloseTab',
  saveAll: 'tabs:SaveAll',
} as const;

/** Id of the "browse" entry of the Open tree list. */
export const BROWSE_ITEM_ID = '\u0000browse';

/** Folder part of a path (either slash), preserving POSIX and Windows drive roots. */
export function parentDir(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (index < 0) {
    return path;
  }
  if (index === 0) {
    return trimmed[0];
  }
  if (index === 2 && /^[A-Za-z]:$/.test(trimmed.slice(0, 2))) {
    return trimmed.slice(0, 3);
  }
  return trimmed.slice(0, index);
}

/** Trees of the project that contains the folder (all of them, not just the folder's). */
export async function listProjectTrees(dir: string): Promise<WorkspaceTree[]> {
  let workspace = await fetchWorkspace(dir);
  if (workspace.projectDir && workspace.projectDir !== workspace.dir) {
    workspace = await fetchWorkspace(workspace.projectDir);
  }
  return workspace.trees;
}

async function browse(tabs: TabsStore, dir: string | undefined): Promise<void> {
  try {
    const result = await pickPath('file', dir);
    if (!('cancelled' in result)) {
      tabs.getState().open(result.path);
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 501) {
      alerts.info(t('No native file dialog is available. Pick a tree from the list instead.'));
    } else {
      alerts.error(err instanceof Error ? err.message : String(err));
    }
  }
}

let openDialogSeq = 0;

/**
 * Lists the trees of the active tree's project (plus "Browse…" for the native file dialog);
 * the chosen tree opens in a new tab, or its tab is activated when it is already open.
 */
export async function openTreeDialog(tabs: TabsStore = tabsStore): Promise<void> {
  const seq = ++openDialogSeq;
  const treePath = commandContext.tree.getState().treePath;
  const dir = treePath ? parentDir(treePath) : undefined;
  let trees: WorkspaceTree[] = [];
  if (dir) {
    try {
      trees = await listProjectTrees(dir);
    } catch {
      // Without a listing only Browse… is offered.
    }
  }
  if (
    seq !== openDialogSeq ||
    !tabs.getState().live ||
    commandContext.tree.getState().treePath !== treePath
  ) {
    return;
  }
  const openPaths = tabs.getState().tabs.map((tab) => tab.path);
  commandContext.ui.getState().open(
    [
      { id: BROWSE_ITEM_ID, name: t('Browse…'), icon: 'folder-open' },
      ...trees.map((tree) => ({
        id: tree.path,
        name: tree.relPath,
        hint: openPaths.some((openPath) => samePath(openPath, tree.path)) ? t('open') : undefined,
      })),
    ],
    (id) => {
      if (id === BROWSE_ITEM_ID) {
        void browse(tabs, dir);
      } else {
        tabs.getState().open(id);
      }
    },
  );
}

function hasTabs(): boolean {
  return tabsStore.getState().live && tabsStore.getState().activeId !== undefined;
}

export const tabCommands: Command[] = [
  {
    id: TAB_COMMAND_IDS.open,
    name: t('Open tree…'),
    hotkey: 'mod+o',
    allowInInput: true,
    canExec: () => tabsStore.getState().live,
    exec: () => openTreeDialog(),
  },
  {
    id: TAB_COMMAND_IDS.next,
    name: t('Next tab'),
    hotkey: 'ctrl+tab',
    allowInInput: true,
    canExec: () => tabsStore.getState().tabs.length > 1 && hasTabs(),
    exec: () => tabsStore.getState().cycle(1),
  },
  {
    id: TAB_COMMAND_IDS.previous,
    name: t('Previous tab'),
    hotkey: 'ctrl+shift+tab',
    allowInInput: true,
    canExec: () => tabsStore.getState().tabs.length > 1 && hasTabs(),
    exec: () => tabsStore.getState().cycle(-1),
  },
  {
    id: TAB_COMMAND_IDS.close,
    name: t('Close tab'),
    hotkey: 'mod+w',
    allowInInput: true,
    canExec: hasTabs,
    async exec() {
      flushActiveInput();
      const { activeId } = tabsStore.getState();
      if (activeId !== undefined) {
        await tabsStore.getState().close(activeId);
      }
    },
  },
  {
    id: TAB_COMMAND_IDS.saveAll,
    name: t('Save all'),
    hotkey: 'mod+shift+s',
    allowInInput: true,
    canExec: () => tabsStore.getState().tabs.some((tab) => tab.dirty),
    async exec() {
      flushActiveInput();
      await tabsStore.getState().saveAll();
    },
  },
];

for (const command of tabCommands) {
  registerCommand(command);
}

/**
 * Second hotkeys of the tab commands. Browsers keep Ctrl+Tab and Ctrl+W for themselves, so
 * Ctrl+PageDown / Ctrl+PageUp and Ctrl+F4 work as well (the desktop app gets all of them).
 */
export const TAB_HOTKEY_ALIASES: ReadonlyArray<readonly [hotkey: string, commandId: string]> = [
  ['ctrl+pagedown', TAB_COMMAND_IDS.next],
  ['ctrl+pageup', TAB_COMMAND_IDS.previous],
  ['ctrl+f4', TAB_COMMAND_IDS.close],
];

/** Runs the tab command of an alias hotkey. Returns true when the event was handled. */
export function handleTabHotkeyAlias(event: KeyboardEvent): boolean {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.keyCode === 229 ||
    commandContext.ui.getState().current !== undefined ||
    tabsStore.getState().closePrompt !== undefined
  ) {
    return false;
  }
  for (const [hotkey, commandId] of TAB_HOTKEY_ALIASES) {
    if (matchesHotkey(event, hotkey)) {
      event.preventDefault();
      void execCommand(commandId);
      return true;
    }
  }
  return false;
}

/** File name shown on a tab. */
export function tabTitle(path: string): string {
  return getPathLastSegment(path) || path;
}
