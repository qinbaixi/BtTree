import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  compileProject,
  createIdGen,
  createRun,
  forEachNode,
  nodeFromJson,
  validateProjectFile,
  type ProjectFile,
  type TickResult,
  type TreeNodeJson,
} from '@owlbt/shared';

const sampleDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'samples',
  'simulation',
);
const file = JSON.parse(readFileSync(join(sampleDir, 'owl-bt.json'), 'utf8')) as ProjectFile;
const tree = JSON.parse(
  readFileSync(join(sampleDir, 'trees', 'guard.json'), 'utf8'),
) as TreeNodeJson;

function play(scenario: string, maxTicks = 60) {
  const blackboard = file.scenarios?.find((s) => s.name === scenario)?.blackboard;
  if (!blackboard) throw new Error(`no scenario ${scenario}`);
  const root = nodeFromJson(tree, createIdGen());
  const labels = new Map<string, string>();
  forEachNode(root, (n) => labels.set(n.id, n.label ?? n.type));
  const run = createRun(root, compileProject(file), { blackboard });
  const history: TickResult[] = [run.snapshot()];
  for (let i = 0; i < maxTicks; i++) {
    const pending = run.pendingManual();
    if (pending) run.resolveManual(pending, 'success');
    history.push(run.tick());
    if (history[history.length - 1].finished) break;
  }
  const messages = history.flatMap((r) =>
    r.log.map((l) => `${labels.get(l.nodeId)}: ${l.message}`),
  );
  return { history, last: history[history.length - 1], messages };
}

describe('samples/simulation', () => {
  it('is a valid project with scenarios', () => {
    expect(validateProjectFile(file)).toEqual([]);
    expect(file.scenarios?.map((s) => s.name)).toEqual([
      'Enemy in sight',
      'No enemy',
      'Out of ammo',
    ]);
  });

  it('fights, reloads and holds position when the enemy is in sight', () => {
    const { last, messages } = play('Enemy in sight');
    expect(last.finished).toBe('success');
    expect(last.blackboard.Ammo).toBe(0);
    expect(last.blackboard.LastSaid).toBe('Alert!');
    expect(messages).toContain('Reload: success');
    expect(messages).toContain('Combat: loop 3/4 done');
  });

  it('patrols when there is no enemy', () => {
    const { last, messages } = play('No enemy');
    expect(last.finished).toBe('success');
    expect(last.blackboard.Position).toBe('Waypoint B');
    expect(messages).toContain('Combat: failure');
    expect(messages).toContain('Report in: waiting for manual result');
  });

  it('reloads first when out of ammo, then the cooldown makes it hold position', () => {
    const { last, messages } = play('Out of ammo');
    expect(last.finished).toBe('success');
    expect(messages.indexOf('Reload: success')).toBeGreaterThan(-1);
    expect(messages).toContain('Hold position: Invert: failure → success');
    expect(messages.some((m) => m.includes('cooling down'))).toBe(true);
  });

  it('scans every tick while the root runs', () => {
    const { last } = play('No enemy');
    expect(last.blackboard.ScanCount).toBe(last.tick);
  });

  it('aborts patrolling when an enemy shows up (periodic inverted decorator)', () => {
    const blackboard = { Enemy: false, Ammo: 3, ScanCount: 0 };
    const root = nodeFromJson(tree, createIdGen());
    const run = createRun(root, compileProject(file), { blackboard });
    run.tick();
    run.tick();
    run.setBlackboardValue('Enemy', true);
    const r = run.tick();
    const patrol = root.childNodes[1];
    expect(r.statuses[patrol.id]).toBe('failure');
    expect(r.subStatuses[patrol.decorators[0].id]).toBe('fail');
    // The root selector already tried Combat before the patrol started, so it has nothing left to try.
    expect(r.finished).toBe('failure');
  });
});
