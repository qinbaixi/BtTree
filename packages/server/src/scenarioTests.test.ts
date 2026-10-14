import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProjectFile } from '@owlbt/shared';
import { createApp } from './app';
import {
  formatScenarioReport,
  runScenarioTests,
  ScenarioConfigError,
  toJUnitXml,
  treeFilterMatches,
} from './scenarioTests';
import { runTestCommand, TEST_EXIT_CONFIG, TEST_EXIT_FAILED, TEST_EXIT_OK } from './testCommand';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const sampleDir = join(repoRoot, 'samples', 'simulation');

const PROJECT: ProjectFile = {
  nodes: [
    { name: 'Sequence', isComposite: true },
    {
      name: 'Shoot',
      simulate: { mode: 'rule', duration: 1, condition: 'Ammo > 0', effects: ['Ammo = Ammo - 1'] },
    },
  ],
  scenarios: [
    {
      name: 'Full',
      blackboard: { Ammo: 2 },
      expect: { result: 'success', blackboard: { Ammo: 0 } },
    },
    {
      name: 'Empty',
      blackboard: { Ammo: 0 },
      expect: { result: 'success' },
    },
    { name: 'Report only', blackboard: { Ammo: 5 }, trees: 'trees/sub/**' },
  ],
};

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) } };
}

describe('scenario tests', () => {
  let root: string;

  const writeProject = (file: ProjectFile) =>
    writeFileSync(join(root, 'owl-bt.json'), JSON.stringify(file, null, 2));

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'owlbt-scenario-tests-'));
    mkdirSync(join(root, 'trees', 'sub'), { recursive: true });
    writeProject(PROJECT);
    const twice = { type: 'Sequence', childNodes: [{ type: 'Shoot' }, { type: 'Shoot' }] };
    writeFileSync(join(root, 'trees', 'a.json'), JSON.stringify(twice));
    writeFileSync(join(root, 'trees', 'sub', 'b.json'), JSON.stringify(twice));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('runScenarioTests', () => {
    it('passes for samples/simulation', async () => {
      const report = await runScenarioTests(sampleDir);
      expect(report.ok).toBe(true);
      expect(report.summary).toEqual({ total: 3, passed: 3, failed: 0, ran: 0, errors: 0 });
      expect(report.cases.map((c) => `${c.tree} ${c.scenario} ${c.status}`)).toEqual([
        'trees/guard.json Enemy in sight pass',
        'trees/guard.json No enemy pass',
        'trees/guard.json Out of ammo pass',
      ]);
    });

    it('runs every tree × scenario combination of a project', async () => {
      const report = await runScenarioTests(root);
      expect(report.cases.map((c) => `${c.tree} ${c.scenario} ${c.status}`)).toEqual([
        'trees/a.json Full pass',
        'trees/a.json Empty fail',
        'trees/sub/b.json Full pass',
        'trees/sub/b.json Empty fail',
        'trees/sub/b.json Report only ran',
      ]);
      expect(report.ok).toBe(false);
      expect(report.summary).toEqual({ total: 5, passed: 2, failed: 2, ran: 1, errors: 0 });
      const empty = report.cases[1];
      expect(empty.result).toBe('failure');
      expect(empty.failures).toEqual(['expected success, got failure']);
    });

    it('limits the run to a tree file or a folder', async () => {
      const file = await runScenarioTests(join(root, 'trees', 'a.json'));
      expect(new Set(file.cases.map((c) => c.tree))).toEqual(new Set(['trees/a.json']));
      const folder = await runScenarioTests(join(root, 'trees', 'sub'));
      expect(new Set(folder.cases.map((c) => c.tree))).toEqual(new Set(['trees/sub/b.json']));
    });

    it('applies the tree and scenario filters', async () => {
      const report = await runScenarioTests(root, { trees: ['b'], scenarios: ['Full'] });
      expect(report.cases.map((c) => `${c.tree} ${c.scenario}`)).toEqual(['trees/sub/b.json Full']);
      expect(treeFilterMatches('trees/a.json', 'trees/a.json')).toBe(true);
      expect(treeFilterMatches('trees/a', 'trees/a.json')).toBe(true);
      expect(treeFilterMatches('a.json', 'trees/a.json')).toBe(true);
      expect(treeFilterMatches('*.json', 'trees/sub/b.json')).toBe(true);
      expect(treeFilterMatches('sub/*', 'trees/a.json')).toBe(false);
      expect(treeFilterMatches('ta', 'trees/ta2.json')).toBe(false);
    });

    it('uses the given project content instead of the file', async () => {
      const report = await runScenarioTests(root, {
        project: { ...PROJECT, scenarios: [PROJECT.scenarios![0]] },
      });
      expect(report.ok).toBe(true);
    });

    it('reports trees that cannot be loaded as errors', async () => {
      writeFileSync(join(root, 'trees', 'broken.json'), '{"type": "Sequence", "childNodes": 5}');
      const report = await runScenarioTests(join(root, 'trees', 'broken.json'), {
        scenarios: ['Full'],
      });
      expect(report.cases[0].status).toBe('error');
      expect(report.summary.errors).toBe(1);
      expect(report.ok).toBe(false);
    });

    it('throws configuration errors', async () => {
      const noProject = mkdtempSync(join(tmpdir(), 'owlbt-scenario-noproj-'));
      try {
        await expect(runScenarioTests(noProject)).rejects.toThrow(/No owl-bt.json/);
      } finally {
        rmSync(noProject, { recursive: true, force: true });
      }
      await expect(runScenarioTests(join(root, 'missing'))).rejects.toThrow(ScenarioConfigError);
      await expect(runScenarioTests(root, { scenarios: ['Nope'] })).rejects.toThrow(
        "Unknown scenario 'Nope'",
      );
      await expect(runScenarioTests(root, { trees: ['zzz'] })).rejects.toThrow(
        'No tree matches --tree zzz',
      );
      writeProject({ ...PROJECT, scenarios: [{ name: 'X', blackboard: {}, maxTicks: -1 }] });
      await expect(runScenarioTests(root)).rejects.toThrow(/scenarios\[0\]\.maxTicks/);
      writeProject({ nodes: PROJECT.nodes });
      await expect(runScenarioTests(root)).rejects.toThrow(/No scenarios defined/);
      writeFileSync(join(root, 'owl-bt.json'), '{ nope');
      await expect(runScenarioTests(root)).rejects.toThrow(/Invalid project file/);
    });
  });

  describe('output', () => {
    it('formats a readable summary', async () => {
      const text = formatScenarioReport(await runScenarioTests(root));
      expect(text).toContain('PASS trees/a.json › Full → success in 3 ticks');
      expect(text).toContain('FAIL trees/a.json › Empty → failure in 2 ticks');
      expect(text).toContain('       expected success, got failure');
      expect(text).toContain('RAN  trees/sub/b.json › Report only → success in 3 ticks');
      expect(text).toContain('5 scenario tests: 2 passed, 2 failed, 1 without expectations');
    });

    it('writes JUnit XML', async () => {
      const xml = toJUnitXml(await runScenarioTests(root));
      expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<testsuites /);
      expect(xml).toContain('tests="5" failures="2" errors="0"');
      expect(xml).toContain('<testsuite name="trees/a.json" tests="2" failures="1" errors="0"');
      expect(xml).toContain(
        '<failure message="expected success, got failure" type="ScenarioExpectation">',
      );
      expect(xml).toContain('<testcase name="Report only" classname="trees.sub.b"');
    });

    it('escapes XML special characters', async () => {
      writeProject({
        ...PROJECT,
        scenarios: [{ name: 'A <&> "b"', blackboard: { Ammo: 0 }, expect: { result: 'success' } }],
      });
      const xml = toJUnitXml(await runScenarioTests(root));
      expect(xml).toContain('name="A &lt;&amp;&gt; &quot;b&quot;"');
    });
  });

  describe('runTestCommand', () => {
    it('returns 0 when every test passes', async () => {
      const { out, io } = capture();
      expect(await runTestCommand(sampleDir, {}, io)).toBe(TEST_EXIT_OK);
      expect(out.join('\n')).toContain('3 scenario tests: 3 passed, 0 failed');
    });

    it('returns 1 on failures and prints JSON', async () => {
      const { out, io } = capture();
      expect(await runTestCommand(root, { json: true }, io)).toBe(TEST_EXIT_FAILED);
      const report = JSON.parse(out.join('\n')) as { ok: boolean; cases: unknown[] };
      expect(report.ok).toBe(false);
      expect(report.cases).toHaveLength(5);
    });

    it('returns 2 on configuration errors', async () => {
      const { out, err, io } = capture();
      expect(await runTestCommand(root, { scenario: ['Nope'], json: true }, io)).toBe(
        TEST_EXIT_CONFIG,
      );
      expect(err[0]).toBe("owlbt: configuration error: Unknown scenario 'Nope'");
      expect(JSON.parse(out[0])).toEqual({ ok: false, configError: "Unknown scenario 'Nope'" });
    });

    it('writes the JUnit report', async () => {
      const { io } = capture();
      const target = join(root, 'reports', 'junit.xml');
      expect(await runTestCommand(root, { junit: target, tree: ['a'] }, io)).toBe(TEST_EXIT_FAILED);
      expect(readFileSync(target, 'utf8')).toContain('tests="2" failures="1"');
    });
  });

  describe('POST /api/scenario-tests', () => {
    const app = () => createApp({ clientDist: join(root, 'no-client-build') });

    it('returns the report', async () => {
      const res = await request(app())
        .post('/api/scenario-tests')
        .send({ path: root, scenarios: ['Full'] });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.summary.total).toBe(2);
    });

    it('tests unsaved project content', async () => {
      const res = await request(app())
        .post('/api/scenario-tests')
        .send({
          path: join(root, 'owl-bt.json'),
          project: { ...PROJECT, scenarios: [{ name: 'Only', blackboard: { Ammo: 9 } }] },
        });
      expect(res.status).toBe(200);
      expect(res.body.cases.map((c: { scenario: string }) => c.scenario)).toEqual(['Only', 'Only']);
    });

    it('returns 400 for bad requests and configuration errors', async () => {
      const relative = await request(app()).post('/api/scenario-tests').send({ path: 'x' });
      expect(relative.status).toBe(400);
      const badList = await request(app())
        .post('/api/scenario-tests')
        .send({ path: root, scenarios: 'Full' });
      expect(badList.status).toBe(400);
      const unknown = await request(app())
        .post('/api/scenario-tests')
        .send({ path: root, scenarios: ['Nope'] });
      expect(unknown.status).toBe(400);
      expect(unknown.text).toBe("Unknown scenario 'Nope'");
    });
  });

  describe('owlbt test (process)', () => {
    const runCli = (args: string[]) =>
      new Promise<{ code: number | null; stdout: string; stderr: string }>((done) => {
        execFile(
          process.execPath,
          ['--import', 'tsx', join(repoRoot, 'packages', 'server', 'src', 'cli.ts'), ...args],
          { cwd: repoRoot, env: { ...process.env, NODE_ENV: 'production' } },
          (error, stdout, stderr) => {
            done({ code: error ? (error.code as number) : 0, stdout, stderr });
          },
        );
      });

    it('exits with 0, 1 and 2', async () => {
      const [ok, failed, config] = await Promise.all([
        runCli(['test', sampleDir]),
        runCli(['test', root, '--json']),
        runCli(['test', root, '--scenario', 'Nope']),
      ]);
      expect(ok.code).toBe(0);
      expect(ok.stdout).toContain('3 passed');
      expect(failed.code).toBe(1);
      expect(JSON.parse(failed.stdout).summary.failed).toBe(2);
      expect(config.code).toBe(2);
      expect(config.stderr).toContain("Unknown scenario 'Nope'");
    }, 30_000);
  });
});
