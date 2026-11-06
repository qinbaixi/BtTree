import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Router } from 'express';
import { HttpError } from './errors';
import { loadWorkspace } from './workspace';

/** Samples bundled next to the built server (dist/samples, copied by the build). */
const BUNDLED_SAMPLES_DIR = fileURLToPath(new URL('./samples/', import.meta.url));
/** The repository's samples folder, for running from source. Resolves from both src/ and dist/. */
const REPO_SAMPLES_DIR = fileURLToPath(new URL('../../../samples/', import.meta.url));
/** File in a sample copy that records which content it was copied from. */
const MARKER_FILE = '.owlbt-sample';
const SAMPLE_ID = /^[a-z0-9][a-z0-9_-]*$/i;

/**
 * Folder with the built-in samples: OWLBT_SAMPLES_DIR (the desktop app points it at its resources),
 * else the copy bundled with the server, else the repository's samples folder.
 */
export function samplesDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.OWLBT_SAMPLES_DIR) {
    return resolve(env.OWLBT_SAMPLES_DIR);
  }
  return existsSync(BUNDLED_SAMPLES_DIR) ? BUNDLED_SAMPLES_DIR : REPO_SAMPLES_DIR;
}

/**
 * Writable folder the samples are copied to before they are opened, so that the bundled ones stay
 * untouched (they are read-only inside an installed app). OWLBT_SAMPLES_HOME overrides it.
 */
export function samplesHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.OWLBT_SAMPLES_HOME
    ? resolve(env.OWLBT_SAMPLES_HOME)
    : join(homedir(), '.owlbt', 'samples');
}

export interface SampleInfo {
  id: string;
  /** Tree files, relative to the sample folder, with forward slashes. */
  trees: string[];
}

async function listFiles(dir: string, base = dir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') {
      continue;
    }
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path, base)));
    } else if (entry.isFile()) {
      files.push(relative(base, path).split(sep).join('/'));
    }
  }
  return files.sort();
}

/** Content hash of a sample folder, so that a copy made from older content is replaced. */
async function fingerprint(dir: string): Promise<string> {
  const hash = createHash('sha256');
  for (const file of await listFiles(dir)) {
    hash
      .update(file)
      .update('\0')
      .update(await readFile(join(dir, file)))
      .update('\0');
  }
  return hash.digest('hex');
}

async function isSampleDir(dir: string): Promise<boolean> {
  try {
    return (await stat(join(dir, 'owl-bt.json'))).isFile();
  } catch {
    return false;
  }
}

/** The built-in samples: subfolders of samplesDir() with an owl-bt.json. */
export async function listSamples(source = samplesDir()): Promise<SampleInfo[]> {
  let names: string[];
  try {
    names = (await readdir(source, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && SAMPLE_ID.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
  const samples: SampleInfo[] = [];
  for (const id of names) {
    const dir = join(source, id);
    if (!(await isSampleDir(dir))) {
      continue;
    }
    const workspace = await loadWorkspace(dir);
    samples.push({ id, trees: workspace.trees.map((tree) => tree.relPath) });
  }
  return samples;
}

export interface OpenedSample {
  id: string;
  /** Folder of the writable copy. */
  dir: string;
  projectPath: string;
  trees: Array<{ path: string; relPath: string }>;
}

/**
 * Copies a sample to samplesHome()/<id> unless an up-to-date copy is there already, and lists its
 * trees. A copy made from different (older) sample content is replaced, edits included.
 */
export async function openSample(
  id: string,
  source = samplesDir(),
  home = samplesHome(),
): Promise<OpenedSample> {
  if (!SAMPLE_ID.test(id)) {
    throw new HttpError(400, 'Invalid sample id');
  }
  const from = join(source, id);
  if (!(await isSampleDir(from))) {
    throw new HttpError(404, `Unknown sample: ${id}`);
  }
  const dir = join(home, id);
  const print = await fingerprint(from);
  let current: string | undefined;
  try {
    current = (await readFile(join(dir, MARKER_FILE), 'utf8')).trim();
  } catch {
    current = undefined;
  }
  if (current !== print) {
    await rm(dir, { recursive: true, force: true });
    await mkdir(home, { recursive: true });
    await cp(from, dir, { recursive: true });
    await writeFile(join(dir, MARKER_FILE), `${print}\n`, 'utf8');
  }
  const workspace = await loadWorkspace(dir);
  return {
    id,
    dir: workspace.dir,
    projectPath: workspace.projectPath ?? join(dir, 'owl-bt.json'),
    trees: workspace.trees.map(({ path, relPath }) => ({ path, relPath })),
  };
}

/**
 * Built-in samples:
 * - GET /samples lists them: { samples: [{ id, trees }] }.
 * - POST /samples/open { id } copies one to a writable folder and lists its trees.
 * Must be registered after the JSON body parser.
 */
export function registerSampleRoutes(router: Router): void {
  router.get('/samples', async (_req, res) => {
    res.json({ samples: await listSamples() });
  });

  router.post('/samples/open', async (req, res) => {
    const { id } = (req.body ?? {}) as { id?: unknown };
    if (typeof id !== 'string') {
      throw new HttpError(400, 'Missing sample id');
    }
    res.json(await openSample(id));
  });
}
