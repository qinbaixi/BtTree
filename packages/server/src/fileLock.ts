import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { chmod, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Tail of the queue of each file path that has a write in progress or waiting. */
const queues = new Map<string, Promise<void>>();

const CASE_INSENSITIVE_FS = process.platform === 'win32' || process.platform === 'darwin';

function lockKey(path: string): string {
  let canonical: string;
  try {
    canonical = realpathSync(path);
  } catch {
    canonical = resolve(path);
  }
  return CASE_INSENSITIVE_FS ? canonical.toLowerCase() : canonical;
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

const WIN_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const WIN_RETRY_DELAYS_MS = [15, 30, 60, 120, 240];

async function renameWithWinRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (
        process.platform !== 'win32' ||
        code === undefined ||
        !WIN_RETRY_CODES.has(code) ||
        attempt >= WIN_RETRY_DELAYS_MS.length
      ) {
        throw err;
      }
      await new Promise((resolveTimer) => setTimeout(resolveTimer, WIN_RETRY_DELAYS_MS[attempt]));
    }
  }
}

/**
 * Replaces the file content: writes a temporary file next to the target, then renames it over the
 * target, so a crash or a failed write never leaves a half-written file. Symlinks are followed.
 */
export async function writeFileAtomic(path: string, data: string | Uint8Array): Promise<void> {
  const target = await realpath(path).catch(() => path);
  const existingMode =
    process.platform !== 'win32'
      ? await stat(target)
          .then((info) => info.mode)
          .catch(() => undefined)
      : undefined;
  const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    if (typeof data === 'string') {
      await writeFile(temp, data, 'utf8');
    } else {
      await writeFile(temp, data);
    }
    if (existingMode !== undefined) {
      await chmod(temp, existingMode).catch(() => undefined);
    }
    await renameWithWinRetry(temp, target);
  } catch (err) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw err;
  }
}
