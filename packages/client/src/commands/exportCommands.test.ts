import { createIdGen, type TreeNodeJson } from '@owlbt/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportTree } from '../lib/api';
import { createAlertStore } from '../store/alertStore';
import { createDialogStore } from '../store/dialogStore';
import { createProjectStore } from '../store/projectStore';
import { createTreeStore } from '../store/treeStore';
import { EXPORT_COMMAND_IDS, EXPORT_SUCCESS_ALERT_MS, coreCommands } from './coreCommands';
import { commandRegistry, type Command, type CommandContext } from './registry';

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return { ...actual, exportTree: vi.fn() };
});

const exportTreeMock = vi.mocked(exportTree);

const TREE: TreeNodeJson = { type: 'Selector', label: 'Root' };

function cmd(id: string): Command {
  const command = coreCommands.find((c) => c.id === id);
  if (!command) {
    throw new Error(`no command ${id}`);
  }
  return command;
}

function setup(options: { saveOk?: boolean } = {}) {
  const saveTree = vi.fn(async () => {
    if (options.saveOk === false) {
      throw new Error('disk full');
    }
  });
  const projectStore = createProjectStore({
    fetchProject: async () => '{}',
    createSocket: () => ({ on: () => undefined, disconnect: () => undefined }),
  });
  const ctx: CommandContext = {
    tree: createTreeStore({
      fetchTree: async () => structuredClone(TREE),
      saveTree,
      idGen: createIdGen('t'),
    }),
    project: projectStore,
    alerts: createAlertStore(),
    ui: createDialogStore(projectStore),
  };
  return { ctx, saveTree };
}

/** Same as setup, with the tree loaded from the mocked fetch. */
async function loadedSetup(options: Parameters<typeof setup>[0] = {}) {
  const env = setup(options);
  await env.ctx.tree.getState().load('tree.json');
  return env;
}

function alertsOf(ctx: CommandContext) {
  return ctx.alerts.getState().alerts;
}

beforeEach(() => {
  exportTreeMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('export commands', () => {
  it('registers the export commands with their names', () => {
    expect(cmd(EXPORT_COMMAND_IDS.erlang).name).toBe('Export: Erlang');
    expect(cmd(EXPORT_COMMAND_IDS.lua).name).toBe('Export: Lua');
    expect(cmd(EXPORT_COMMAND_IDS.ts).name).toBe('Export: TypeScript');
    expect(cmd(EXPORT_COMMAND_IDS.cs).name).toBe('Export: C#');
    expect(cmd(EXPORT_COMMAND_IDS.go).name).toBe('Export: Go');
    expect(cmd(EXPORT_COMMAND_IDS.all).name).toBe('Export: All formats');
    expect(EXPORT_COMMAND_IDS.ts).toBe('core:ExportTs');
    expect(EXPORT_COMMAND_IDS.cs).toBe('core:ExportCs');
    expect(EXPORT_COMMAND_IDS.go).toBe('core:ExportGo');
    expect(EXPORT_COMMAND_IDS.all).toBe('core:ExportAll');
    for (const id of Object.values(EXPORT_COMMAND_IDS)) {
      expect(commandRegistry[id]).toBeDefined();
    }
  });

  it('exports TypeScript, C# and Go with their own commands', async () => {
    const { ctx } = await loadedSetup();
    exportTreeMock.mockResolvedValue({ treePath: 'tree.json', files: [], warnings: [] });

    await cmd(EXPORT_COMMAND_IDS.ts).exec(ctx);
    await cmd(EXPORT_COMMAND_IDS.cs).exec(ctx);
    await cmd(EXPORT_COMMAND_IDS.go).exec(ctx);

    expect(exportTreeMock.mock.calls).toEqual([
      ['tree.json', ['ts']],
      ['tree.json', ['cs']],
      ['tree.json', ['go']],
    ]);
  });

  it('cannot run until a tree is loaded', async () => {
    const { ctx } = setup();
    expect(cmd(EXPORT_COMMAND_IDS.erlang).canExec(ctx)).toBe(false);
    await ctx.tree.getState().load('tree.json');
    expect(cmd(EXPORT_COMMAND_IDS.erlang).canExec(ctx)).toBe(true);
  });

  it('exports a clean tree without asking to save and lists the written files', async () => {
    const { ctx, saveTree } = await loadedSetup();
    const confirm = vi.spyOn(window, 'confirm');
    exportTreeMock.mockResolvedValue({
      treePath: 'tree.json',
      files: [{ format: 'erlang', path: 'D:/p/export/erlang/tree.erl' }],
      warnings: [],
    });

    await cmd(EXPORT_COMMAND_IDS.erlang).exec(ctx);

    expect(confirm).not.toHaveBeenCalled();
    expect(saveTree).not.toHaveBeenCalled();
    expect(exportTreeMock).toHaveBeenCalledWith('tree.json', ['erlang']);
    const [success] = alertsOf(ctx);
    expect(success.type).toBe('success');
    expect(success.message).toBe('Exported:\nD:/p/export/erlang/tree.erl');
    expect(success.autoHideMs).toBe(EXPORT_SUCCESS_ALERT_MS);
  });

  it('exports all four formats for the combined command', async () => {
    const { ctx } = await loadedSetup();
    exportTreeMock.mockResolvedValue({ treePath: 'tree.json', files: [], warnings: [] });
    await cmd(EXPORT_COMMAND_IDS.all).exec(ctx);
    expect(exportTreeMock).toHaveBeenCalledWith('tree.json', ['erlang', 'lua', 'ts', 'cs', 'go']);
  });

  it('asks before saving a dirty tree and does nothing when the user declines', async () => {
    const { ctx, saveTree } = await loadedSetup();
    ctx.tree.getState().apply('Edit', (draft) => {
      draft.label = 'Changed';
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

    await cmd(EXPORT_COMMAND_IDS.lua).exec(ctx);

    expect(confirm).toHaveBeenCalledWith('Save changes before exporting?');
    expect(saveTree).not.toHaveBeenCalled();
    expect(exportTreeMock).not.toHaveBeenCalled();
  });

  it('saves a dirty tree first, then exports', async () => {
    const { ctx, saveTree } = await loadedSetup();
    ctx.tree.getState().apply('Edit', (draft) => {
      draft.label = 'Changed';
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    exportTreeMock.mockResolvedValue({ treePath: 'tree.json', files: [], warnings: [] });

    await cmd(EXPORT_COMMAND_IDS.lua).exec(ctx);

    expect(saveTree).toHaveBeenCalledTimes(1);
    expect(saveTree.mock.invocationCallOrder[0]).toBeLessThan(
      exportTreeMock.mock.invocationCallOrder[0],
    );
    expect(ctx.tree.getState().dirty).toBe(false);
  });

  it('aborts the export when saving fails', async () => {
    const { ctx, saveTree } = await loadedSetup({ saveOk: false });
    ctx.tree.getState().apply('Edit', (draft) => {
      draft.label = 'Changed';
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    await cmd(EXPORT_COMMAND_IDS.erlang).exec(ctx);

    expect(saveTree).toHaveBeenCalledTimes(1);
    expect(exportTreeMock).not.toHaveBeenCalled();
  });

  it('shows warnings as a warning alert and errors as an error alert', async () => {
    const { ctx } = await loadedSetup();
    exportTreeMock.mockResolvedValue({
      treePath: 'tree.json',
      files: [],
      warnings: ["root: invalid value for property 'duration'"],
      error: "Missing node type 'Nope' at root",
    });

    await cmd(EXPORT_COMMAND_IDS.erlang).exec(ctx);

    const types = alertsOf(ctx).map((alert) => alert.type);
    expect(types).toEqual(['warning', 'error']);
    expect(alertsOf(ctx)[1].message).toBe("Export failed: Missing node type 'Nope' at root");
  });

  it('shows a request failure as an error alert', async () => {
    const { ctx } = await loadedSetup();
    exportTreeMock.mockRejectedValue(new Error('No project found'));

    await cmd(EXPORT_COMMAND_IDS.erlang).exec(ctx);

    expect(alertsOf(ctx)).toEqual([
      expect.objectContaining({ type: 'error', message: 'Export failed: No project found' }),
    ]);
  });
});
