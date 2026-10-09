import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectReloadPayload } from '@owlbt/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileWatcherRegistry, toPayload, type WatchFn } from './fileWatcher';

interface FakeWatch {
  path: string;
  onChange: () => void;
  onError: (err: unknown) => void;
  closed: boolean;
}

function setup(initialContent = '{"nodes":[]}') {
  const watches: FakeWatch[] = [];
  let content = initialContent;
  let readError: Error | undefined;

  const watch = vi.fn<WatchFn>((path, onChange, onError) => {
    const entry: FakeWatch = { path, onChange, onError, closed: false };
    watches.push(entry);
    return {
      close() {
        entry.closed = true;
      },
    };
  });
  const readFile = vi.fn(async () => {
    if (readError) {
      throw readError;
    }
    return content;
  });

  const registry = new FileWatcherRegistry({ watch, readFile, debounceMs: 500 });
  return {
    registry,
    watch,
    watches,
    readFile,
    setContent(value: string) {
      content = value;
    },
    failReadsWith(err: Error | undefined) {
      readError = err;
    },
  };
}

describe('FileWatcherRegistry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts one fs watcher per file, shared by many listeners', () => {
    const t = setup();
    t.registry.addListener('/p/owl-bt.json', '1', () => {});
    t.registry.addListener('/p/owl-bt.json', '2', () => {});
    expect(t.watch).toHaveBeenCalledTimes(1);
    expect(t.registry.watchedCount).toBe(1);
  });

  it('watches different files independently', () => {
    const t = setup();
    t.registry.addListener('/a/owl-bt.json', '1', () => {});
    t.registry.addListener('/b/owl-bt.json', '1', () => {});
    expect(t.watch).toHaveBeenCalledTimes(2);
    expect(t.registry.watchedCount).toBe(2);
  });

  it('closes the fs watcher only when the last listener is removed', () => {
    const t = setup();
    t.registry.addListener('/p/owl-bt.json', '1', () => {});
    t.registry.addListener('/p/owl-bt.json', '2', () => {});

    t.registry.removeListener('/p/owl-bt.json', '1');
    expect(t.watches[0].closed).toBe(false);

    t.registry.removeListener('/p/owl-bt.json', '2');
    expect(t.watches[0].closed).toBe(true);
    expect(t.registry.watchedCount).toBe(0);
  });

  it('reopens the fs watcher when a listener is added after close', () => {
    const t = setup();
    t.registry.addListener('/p/owl-bt.json', '1', () => {});
    t.registry.removeListener('/p/owl-bt.json', '1');
    t.registry.addListener('/p/owl-bt.json', '2', () => {});

    expect(t.watch).toHaveBeenCalledTimes(2);
    expect(t.watches[1].closed).toBe(false);
  });

  it('rejects duplicate listener ids', () => {
    const t = setup();
    t.registry.addListener('/p/owl-bt.json', '1', () => {});
    expect(() => t.registry.addListener('/p/owl-bt.json', '1', () => {})).toThrow(
      'duplicate listener id "1"',
    );
  });

  it('ignores removal of unknown listeners', () => {
    const t = setup();
    expect(() => t.registry.removeListener('/nope', 'x')).not.toThrow();
    t.registry.addListener('/p/owl-bt.json', '1', () => {});
    expect(() => t.registry.removeListener('/p/owl-bt.json', 'x')).not.toThrow();
    expect(t.watches[0].closed).toBe(false);
  });

  it('debounces bursts of change events into one read and notifies every listener', async () => {
    const t = setup('{"nodes":[{"name":"A"}]}');
    const first = vi.fn<(p: ProjectReloadPayload) => void>();
    const second = vi.fn<(p: ProjectReloadPayload) => void>();
    t.registry.addListener('/p/owl-bt.json', '1', first);
    t.registry.addListener('/p/owl-bt.json', '2', second);

    t.watches[0].onChange();
    await vi.advanceTimersByTimeAsync(300);
    t.watches[0].onChange();
    await vi.advanceTimersByTimeAsync(300);
    t.watches[0].onChange();

    await vi.advanceTimersByTimeAsync(499);
    expect(t.readFile).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(t.readFile).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith({ content: '{"nodes":[{"name":"A"}]}' });
    expect(second).toHaveBeenCalledWith({ content: '{"nodes":[{"name":"A"}]}' });
  });

  it('sends an error payload when the file is not valid JSON', async () => {
    const t = setup('{ broken');
    const listener = vi.fn<(p: ProjectReloadPayload) => void>();
    t.registry.addListener('/p/owl-bt.json', '1', listener);

    t.watches[0].onChange();
    await vi.advanceTimersByTimeAsync(500);

    expect(listener).toHaveBeenCalledTimes(1);
    const payload = listener.mock.calls[0][0];
    expect(payload).toHaveProperty('error');
    expect(typeof (payload as { error: string }).error).toBe('string');
  });

  it('sends an error payload when the file cannot be read', async () => {
    const t = setup();
    t.failReadsWith(new Error('ENOENT: gone'));
    const listener = vi.fn<(p: ProjectReloadPayload) => void>();
    t.registry.addListener('/p/owl-bt.json', '1', listener);

    t.watches[0].onChange();
    await vi.advanceTimersByTimeAsync(500);

    expect(listener).toHaveBeenCalledWith({ error: 'ENOENT: gone' });
  });

  it('reloads when the watcher reports an error', async () => {
    const t = setup();
    const listener = vi.fn<(p: ProjectReloadPayload) => void>();
    t.registry.addListener('/p/owl-bt.json', '1', listener);

    t.watches[0].onError(new Error('watch failed'));
    await vi.advanceTimersByTimeAsync(500);

    expect(listener).toHaveBeenCalledWith({ content: '{"nodes":[]}' });
  });

  it('does not notify listeners that were removed', async () => {
    const t = setup();
    const removed = vi.fn();
    const kept = vi.fn();
    t.registry.addListener('/p/owl-bt.json', '1', removed);
    t.registry.addListener('/p/owl-bt.json', '2', kept);

    t.watches[0].onChange();
    t.registry.removeListener('/p/owl-bt.json', '1');
    await vi.advanceTimersByTimeAsync(500);

    expect(removed).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending reload when the last listener leaves', async () => {
    const t = setup();
    const listener = vi.fn();
    t.registry.addListener('/p/owl-bt.json', '1', listener);
    t.watches[0].onChange();
    t.registry.removeListener('/p/owl-bt.json', '1');

    await vi.advanceTimersByTimeAsync(1000);
    expect(t.readFile).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('toPayload', () => {
  it('returns content for valid JSON and error otherwise', () => {
    expect(toPayload('{"a":1}')).toEqual({ content: '{"a":1}' });
    expect(toPayload('{')).toHaveProperty('error');
  });
});

describe('FileWatcherRegistry with the real file system', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'owlbt-fw-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('notifies a listener after the watched file changes', async () => {
    const file = join(dir, 'owl-bt.json');
    writeFileSync(file, '{"nodes":[]}');
    const registry = new FileWatcherRegistry({ debounceMs: 50 });

    const payload = await new Promise<ProjectReloadPayload>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no reload event')), 10000);
      registry.addListener(file, 'x', (p) => {
        clearTimeout(timer);
        resolve(p);
      });
      writeFileSync(file, '{"nodes":[{"name":"changed"}]}');
    });

    registry.removeListener(file, 'x');
    expect(payload).toEqual({ content: '{"nodes":[{"name":"changed"}]}' });
    expect(registry.watchedCount).toBe(0);
  });
});
