import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkSubtrees,
  compileProject,
  createIdGen,
  createRun,
  nodeFromJson,
  validateProjectFile,
  type ProjectFile,
  type TreeNodeJson,
} from '@owlbt/shared';
import { describe, expect, it } from 'vitest';
import { loadSubtreeLibrary } from './subtrees';
import { TEMPLATES_DIR } from './workspace';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

describe('SubTree in the templates and samples', () => {
  it('is a ready-to-use subtree type in the project template', () => {
    const project = compileProject(readJson<ProjectFile>(join(TEMPLATES_DIR, 'owl-bt.json')));
    expect(project.nodes.SubTree.subtree).toBe(true);
    expect(project.nodes.SubTree.isComposite).toBe(false);
    expect(project.nodes.SubTree.properties.map((p) => p.name)).toEqual(['Tree']);
  });

  it('runs trees/guard.json from trees/sentry.json in the simulation sample', async () => {
    const sampleDir = join(repoRoot, 'samples', 'simulation');
    const file = readJson<ProjectFile>(join(sampleDir, 'owl-bt.json'));
    expect(validateProjectFile(file)).toEqual([]);
    const project = compileProject(file);
    const root = nodeFromJson(
      readJson<TreeNodeJson>(join(sampleDir, 'trees', 'sentry.json')),
      createIdGen(),
    );
    const library = await loadSubtreeLibrary(sampleDir, project, ['trees/guard.json']);
    expect(checkSubtrees(root, project, library, 'trees/sentry.json').size).toBe(0);

    const blackboard = file.scenarios?.find((s) => s.name === 'Enemy in sight')?.blackboard ?? {};
    const run = createRun(root, project, {
      blackboard,
      subtrees: library,
      treeRef: 'trees/sentry.json',
    });
    let last = run.tick();
    const messages = last.log.map((entry) => entry.message);
    for (let i = 0; i < 60 && !last.finished; i++) {
      const pending = run.pendingManual();
      if (pending) run.resolveManual(pending, 'success');
      last = run.tick();
      messages.push(...last.log.map((entry) => entry.message));
    }
    expect(messages).toContain('entering subtree trees/guard.json');
    expect(last.finished).toBe('success');
    expect(last.blackboard.Ammo).toBe(0);
  });
});
