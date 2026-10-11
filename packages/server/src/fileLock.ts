import { randomUUID } from 'node:crypto';
import { realpath, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Tail of the queue of each file path that has a write in progress or waiting. */
const queues = new Map<string, Promise<void>>();

function lockKey(path: string): string {
  const absolute = resolve(path);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

/**
 * Runs `fn` after every earlier call for the same file path has settled. Use it around a
 * read-check-write sequence so that two requests cannot both pass the check. A failing call does
 * not block the calls queued behind it.
 */
export function withFileLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const key = lockKey(path);
  const previous = queues.get(key) ?? Promise.resolve();
  const run = previous.then(fn);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  queues.set(key, tail);
  void tail.then(() => {
    if (queues.get(key) === tail) {
      queues.delete(key);
    }
  });
  return run;
}

/**
 * Replaces the file content: writes a temporary file next to the target, then renames it over the
 * target, so a crash or a failed write never leaves a half-written file. Symlinks are followed.
 */
export async function writeFileAtomic(path: string, text: string): Promise<void> {
  const target = await realpath(path).catch(() => path);
  const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, text, 'utf8');
    await rename(temp, target);
  } catch (err) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw err;
  }
}
