import { createServer as createNetServer, type AddressInfo, type Server as NetServer } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { run, type RunResult } from './index';

describe('run', () => {
  const cleanup: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) {
      await fn();
    }
  });

  it('starts a server on the requested port and reports it', async () => {
    const seen: Array<{ port: number; reused: boolean }> = [];
    const result: RunResult = await run({
      port: 0,
      clientDist: join(tmpdir(), 'owlbt-no-client-build'),
      onListening: (info) => seen.push(info),
    });
    cleanup.push(async () => {
      await new Promise<void>((resolve) => result.server!.io.close(() => resolve()));
    });

    expect(result.reused).toBe(false);
    expect(result.port).toBeGreaterThan(0);
    expect(result.server).toBeDefined();
    expect(seen).toEqual([{ port: result.port, reused: false }]);
  });

  it('treats an occupied port as success (another instance is running)', async () => {
    const blocker: NetServer = createNetServer();
    await new Promise<void>((resolve) => blocker.listen(0, () => resolve()));
    cleanup.push(() => new Promise<void>((resolve) => blocker.close(() => resolve())));
    const port = (blocker.address() as AddressInfo).port;

    const seen: Array<{ port: number; reused: boolean }> = [];
    const result = await run({
      port,
      clientDist: join(tmpdir(), 'owlbt-no-client-build'),
      onListening: (info) => seen.push(info),
    });

    expect(result).toEqual({ port, reused: true });
    expect(seen).toEqual([{ port, reused: true }]);
  });

  it('rejects for errors other than EADDRINUSE', async () => {
    await expect(run({ port: 70000 })).rejects.toThrow();
  });
});
