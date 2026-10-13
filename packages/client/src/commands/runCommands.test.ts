import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compileProject, createIdGen, nodeFromJson } from '@owlbt/shared';
import { getContextMenuCommands } from '../components/ContextMenu/ContextMenu';
import { projectStore } from '../store/projectStore';
import { runStore } from '../store/runStore';
import { treeStore } from '../store/treeStore';
import { RUN_COMMAND_IDS } from './coreCommands';
import { commandContext, commandRegistry, execCommand } from './registry';

const project = compileProject({
  nodes: [
    { name: 'Sequence', isComposite: true },
    { name: 'Succeed', simulate: { mode: 'success' } },
  ],
  scenarios: [{ name: 'S', blackboard: { A: 1 } }],
});

function loadTree(): string {
  const root = nodeFromJson(
    { type: 'Sequence', childNodes: [{ type: 'Succeed' }, { type: 'Succeed' }] },
    createIdGen('r'),
  );
  treeStore.setState({ root, selection: { kind: 'node', nodeId: root.childNodes[0].id } });
  projectStore.setState({ project, scenarios: [{ name: 'S', blackboard: { A: 1 } }] });
  return root.childNodes[0].id;
}

function can(id: string): boolean {
  return commandRegistry[id].canExec(commandContext);
}

describe('run mode commands', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    runStore.getState().exit();
    treeStore.setState({ root: undefined, selection: undefined });
    projectStore.setState({ project: undefined, scenarios: [] });
  });

  it('registers the run commands with their hotkeys', () => {
    expect(commandRegistry[RUN_COMMAND_IDS.toggle].hotkey).toBe('f5');
    expect(commandRegistry[RUN_COMMAND_IDS.step].hotkey).toBe('f10');
    expect(commandRegistry[RUN_COMMAND_IDS.playPause].hotkey).toBe('f8');
    expect(commandRegistry[RUN_COMMAND_IDS.reset]).toBeDefined();
  });

  it('cannot start without a loaded tree and project', () => {
    expect(can(RUN_COMMAND_IDS.toggle)).toBe(false);
    loadTree();
    expect(can(RUN_COMMAND_IDS.toggle)).toBe(true);
  });

  it('toggles run mode and enables the run controls only while it is on', async () => {
    loadTree();
    expect(can(RUN_COMMAND_IDS.step)).toBe(false);
    expect(can(RUN_COMMAND_IDS.playPause)).toBe(false);
    expect(can(RUN_COMMAND_IDS.reset)).toBe(false);

    await execCommand(RUN_COMMAND_IDS.toggle);
    expect(runStore.getState().active).toBe(true);
    expect(can(RUN_COMMAND_IDS.step)).toBe(true);
    expect(can(RUN_COMMAND_IDS.playPause)).toBe(true);
    expect(can(RUN_COMMAND_IDS.reset)).toBe(true);

    await execCommand(RUN_COMMAND_IDS.step);
    expect(runStore.getState().history.map((r) => r.tick)).toEqual([0, 1]);
    // the tree finished in one tick, so stepping is over
    expect(can(RUN_COMMAND_IDS.step)).toBe(false);
    await execCommand(RUN_COMMAND_IDS.reset);
    expect(runStore.getState().history).toHaveLength(1);
    expect(can(RUN_COMMAND_IDS.step)).toBe(true);

    await execCommand(RUN_COMMAND_IDS.toggle);
    expect(runStore.getState().active).toBe(false);
    expect(can(RUN_COMMAND_IDS.step)).toBe(false);
  });

  it('play / pause toggles playback', async () => {
    loadTree();
    await execCommand(RUN_COMMAND_IDS.toggle);
    await execCommand(RUN_COMMAND_IDS.playPause);
    expect(runStore.getState().playing).toBe(true);
    await execCommand(RUN_COMMAND_IDS.playPause);
    expect(runStore.getState().playing).toBe(false);
  });

  it('has separate Play and Pause commands enabled accordingly', async () => {
    loadTree();
    expect(can(RUN_COMMAND_IDS.play)).toBe(false);
    expect(can(RUN_COMMAND_IDS.pause)).toBe(false);
    expect(commandRegistry[RUN_COMMAND_IDS.play].hotkey).toBeUndefined();
    expect(commandRegistry[RUN_COMMAND_IDS.pause].hotkey).toBeUndefined();
    await execCommand(RUN_COMMAND_IDS.toggle);
    expect(can(RUN_COMMAND_IDS.play)).toBe(true);
    expect(can(RUN_COMMAND_IDS.pause)).toBe(false);
    await execCommand(RUN_COMMAND_IDS.play);
    expect(runStore.getState().playing).toBe(true);
    expect(can(RUN_COMMAND_IDS.play)).toBe(false);
    expect(can(RUN_COMMAND_IDS.pause)).toBe(true);
    await execCommand(RUN_COMMAND_IDS.pause);
    expect(runStore.getState().playing).toBe(false);
  });

  it('makes the tree read-only while running', async () => {
    loadTree();
    const editing = [
      'core:Add',
      'core:Remove',
      'core:MoveLeft',
      'core:MoveRight',
      'core:SetNodeType',
    ];
    // MoveLeft is not possible for the first child, the others are
    expect(editing.filter((id) => can(id))).toEqual([
      'core:Add',
      'core:Remove',
      'core:MoveRight',
      'core:SetNodeType',
    ]);

    await execCommand(RUN_COMMAND_IDS.toggle);
    expect(editing.filter((id) => can(id))).toEqual([]);
    expect(can('core:Paste')).toBe(false);
    expect(can('core:Undo')).toBe(false);
    expect(can('core:Redo')).toBe(false);
    // reading commands stay available
    expect(can('core:Copy')).toBe(true);
    expect(can('core:SelectRight')).toBe(true);
  });

  it('offers Toggle breakpoint in the context menu in run mode only', async () => {
    const nodeId = loadTree();
    const names = () => getContextMenuCommands(commandContext).map((c) => c.name);
    expect(names()).not.toContain('Toggle breakpoint');

    await execCommand(RUN_COMMAND_IDS.toggle);
    expect(names()).toContain('Toggle breakpoint');
    expect(names()).not.toContain('Remove');

    await execCommand(RUN_COMMAND_IDS.breakpoint);
    expect(runStore.getState().breakpoints.has(nodeId)).toBe(true);
    await execCommand(RUN_COMMAND_IDS.breakpoint);
    expect(runStore.getState().breakpoints.has(nodeId)).toBe(false);
  });
});
