import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  formatScenarioReport,
  runScenarioTests,
  ScenarioConfigError,
  toJUnitXml,
  type ScenarioTestReport,
} from './scenarioTests';

/** Exit codes of `owlbt test`. */
export const TEST_EXIT_OK = 0;
export const TEST_EXIT_FAILED = 1;
export const TEST_EXIT_CONFIG = 2;

export interface TestCommandOptions {
  json?: boolean;
  junit?: string;
  tree?: string[];
  scenario?: string[];
}

export interface TestCommandIo {
  out: (text: string) => void;
  err: (text: string) => void;
}

const defaultIo: TestCommandIo = {
  out: (text) => console.log(text),
  err: (text) => console.error(text),
};

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Runs `owlbt test`. Returns the exit code: 0 all passed, 1 a test failed, 2 configuration error. */
export async function runTestCommand(
  pathArg: string | undefined,
  options: TestCommandOptions,
  io: TestCommandIo = defaultIo,
): Promise<number> {
  let report: ScenarioTestReport;
  try {
    report = await runScenarioTests(resolve(pathArg ?? '.'), {
      trees: options.tree,
      scenarios: options.scenario,
    });
  } catch (err) {
    if (options.json) {
      io.out(JSON.stringify({ ok: false, configError: messageOf(err) }, null, 2));
    }
    const prefix = err instanceof ScenarioConfigError ? 'configuration error: ' : '';
    io.err(`owlbt: ${prefix}${messageOf(err)}`);
    return TEST_EXIT_CONFIG;
  }

  if (options.junit !== undefined) {
    const target = resolve(options.junit);
    try {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, toJUnitXml(report), 'utf8');
    } catch (err) {
      io.err(`owlbt: cannot write ${target}: ${messageOf(err)}`);
      return TEST_EXIT_CONFIG;
    }
  }
  io.out(options.json ? JSON.stringify(report, null, 2) : formatScenarioReport(report));
  return report.ok ? TEST_EXIT_OK : TEST_EXIT_FAILED;
}
