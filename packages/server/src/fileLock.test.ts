import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withFileLock, writeFileAtomic } from './fileLock';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('withFileLock', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'owlbt-lock-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('runs calls for the same path one after another', async () => {
    const file = join(root, 'a.json');
    const events: string[] = [];
    const slow = withFileLock(file, async () => {
      events.push('first:start');
      await sleep(30);
      events.push('first:end');
      return 1;
    });
    const fast = withFileLock(file, async () => {
      events.push('second');
      return 2;
    });
    expect(await Promise.all([slow, fast])).toEqual([1, 2]);
    expect(events).toEqual(['first:start', 'first:end', 'second']);
  });

  it('does not serialise different paths', async () => {
    const events: string[] = [];
    const slow = withFileLock(join(root, 'a.json'), async () => {
      await sleep(30);
      events.push('a');
    });
    const other = withFileLock(join(root, 'b.json'), async () => {
      events.push('b');
    });
    await Promise.all([slow, other]);
    expect(events).toEqual(['b', 'a']);
  });

  it('keeps the queue going after a failed call and rethrows its error', async () => {
    const file = join(root, 'a.json');
    const failing = withFileLock(file, async () => {
      throw new Error('boom');
    });
    await expect(failing).rejects.toThrow('boom');
    expect(await withFileLock(file, async () => 'next')).toBe('next');
  });
});

describe('writeFileAtomic', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'owlbt-atomic-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('replaces the content and leaves no temporary files', async () => {
    const file = join(root, 'tree.json');
    writeFileSync(file, 'old');
    await writeFileAtomic(file, 'new content');
    expect(readFileSync(file, 'utf8')).toBe('new content');
    expect(readdirSync(root)).toEqual(['tree.json']);
  });

  it('fails with ENOENT and creates nothing when the folder is missing', async () => {
    await expect(writeFileAtomic(join(root, 'missing', 'tree.json'), 'x')).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(readdirSync(root)).toEqual([]);
  });
});
