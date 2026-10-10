#!/usr/bin/env node
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION } from '@owlbt/shared';
import { Command } from 'commander';
import open from 'open';
import { exportProject, exportTree, parseExportFormats, type ExportTreeResult } from './export';
import { run } from './run';
import { findProjectFile, PROJECT_FILE_NAME } from './project';

// The CLI runs in production mode unless NODE_ENV says otherwise (affects the default port).
process.env.NODE_ENV ??= 'production';

const templatesDir = fileURLToPath(new URL('../templates/', import.meta.url));

function readTemplate(name: string): Promise<string> {
  return readFile(join(templatesDir, name), 'utf8');
}

function describeError(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const { code, path } = err as NodeJS.ErrnoException;
    if (code === 'EEXIST') {
      return `file already exists: ${path ?? ''}`.trim();
    }
    if (code === 'ENOENT') {
      return `no such file or directory: ${path ?? ''}`.trim();
    }
  }
  return err instanceof Error ? err.message : String(err);
}

function fail(err: unknown): never {
  console.error(`owlbt: ${describeError(err)}`);
  process.exit(1);
}

/** True when the browser must not be opened: `--no-open` or OWLBT_NO_OPEN=1. */
function shouldSkipOpen(): boolean {
  return program.opts<{ open: boolean }>().open === false || process.env.OWLBT_NO_OPEN === '1';
}

/** Starts the server (or reuses a running one) and opens the given app path in the browser. */
async function serveAndOpen(pathAndQuery: string): Promise<void> {
  const { port, reused } = await run();
  console.log(
    reused
      ? `owl-bt server already running on port ${port}`
      : `owl-bt server ${VERSION} listening on http://localhost:${port}`,
  );
  const url = `http://localhost:${port}${pathAndQuery}`;
  if (shouldSkipOpen()) {
    console.log(`Open ${url} in a browser.`);
    return;
  }
  try {
    await open(url);
  } catch {
    console.warn(`Could not open a browser. Open ${url} manually.`);
  }
}

const program = new Command();

program
  .name('owlbt')
  .description('owl-bt behavior tree editor')
  .version(VERSION)
  .option('--no-open', 'do not open the browser, only print the URL (or set OWLBT_NO_OPEN=1)')
  .action(async () => {
    await serveAndOpen('/');
  });

program
  .command('init [path]')
  .alias('i')
  .description('init new owl-bt project in a given directory')
  .action(async (pathArg: string | undefined) => {
    const target = join(resolve(pathArg ?? '.'), PROJECT_FILE_NAME);
    await writeFile(target, await readTemplate('owl-bt.json'), { flag: 'wx' });
    console.log(`Created ${target}`);
  });

program
  .command('create <path>')
  .alias('c')
  .description('create a tree file and open it')
  .action(async (pathArg: string) => {
    const treePath = resolve(pathArg);
    if (!(await findProjectFile(treePath))) {
      throw new Error('path is not in owlbt project');
    }
    await mkdir(dirname(treePath), { recursive: true });
    await writeFile(treePath, await readTemplate('tree.json'), { flag: 'wx' });
    console.log(`Created ${treePath}`);
    await serveAndOpen(`/tree?path=${encodeURIComponent(treePath)}`);
  });

program
  .command('open <path>')
  .alias('o')
  .description('open a tree file')
  .action(async (pathArg: string) => {
    const treePath = resolve(pathArg);
    await serveAndOpen(`/tree?path=${encodeURIComponent(treePath)}`);
  });

/** Prints one export result. Returns true when the tree failed. */
function reportExport(result: ExportTreeResult & { relPath?: string }): boolean {
  const label = result.relPath ?? result.treePath;
  for (const file of result.files) {
    console.log(`Wrote ${file.path}`);
  }
  for (const warning of result.warnings) {
    console.warn(`owlbt: warning: ${label}: ${warning}`);
  }
  if (result.error !== undefined) {
    console.error(`owlbt: error: ${label}: ${result.error}`);
    return true;
  }
  return false;
}

program
  .command('export <path>')
  .description('export trees to Erlang and/or Lua: a tree file, or every tree of a project folder')
  .option('--format <formats>', 'comma separated formats: erlang, lua', 'erlang,lua')
  .option('--out <dir>', 'output folder for every format (default: the project export settings)')
  .action(async (pathArg: string, options: { format: string; out?: string }) => {
    const target = resolve(pathArg);
    const formats = parseExportFormats(
      options.format
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name !== ''),
    );
    const outDir = options.out === undefined ? undefined : resolve(options.out);

    const info = await stat(target);
    let failed = false;
    if (info.isDirectory()) {
      const batch = await exportProject(target, formats, { outDir });
      if (batch.results.length === 0) {
        console.log('No tree files found in the project.');
      }
      for (const result of batch.results) {
        failed = reportExport(result) || failed;
      }
      if (batch.truncated) {
        console.warn('owlbt: warning: only the first 500 tree files were exported');
      }
      console.log(`Exported ${batch.results.length} tree(s) from ${batch.projectDir}`);
    } else {
      failed = reportExport(await exportTree(target, formats, { outDir }));
    }
    if (failed) {
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv).catch(fail);
