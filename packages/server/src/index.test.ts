import {
  createServer as createNetServer,
  type AddressInfo,
  type Server as NetServer,
} from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { parseDevOptions, run, type RunResult } from './index';

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
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', () => resolve()));
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

describe('run options', () => {
  const cleanup: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) {
      await fn();
    }
  });

  it('listens on the requested host only', async () => {
    const result = await run({
      port: 0,
      host: '127.0.0.1',
      clientDist: join(tmpdir(), 'owlbt-no-client-build'),
    });
    cleanup.push(() => new Promise<void>((resolve) => result.server!.io.close(() => resolve())));

    expect(result.server!.httpServer.address()).toMatchObject({ address: '127.0.0.1' });
  });

  it('rejects with EADDRINUSE when strictPort is set and the port is busy', async () => {
    const blocker: NetServer = createNetServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', () => resolve()));
    cleanup.push(() => new Promise<void>((resolve) => blocker.close(() => resolve())));
    const port = (blocker.address() as AddressInfo).port;

    await expect(
      run({
        port,
        host: '127.0.0.1',
        strictPort: true,
        clientDist: join(tmpdir(), 'owlbt-no-client-build'),
      }),
    ).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });

  it('uses the injected picker for the dialog route', async () => {
    const calls: Array<{ kind: string; initialDir?: string }> = [];
    const picker = {
      pick: async (kind: 'folder' | 'file', initialDir?: string) => {
        calls.push({ kind, initialDir });
        return { path: '/picked/folder' };
      },
    };
    const result = await run({
      port: 0,
      host: '127.0.0.1',
      picker,
      clientDist: join(tmpdir(), 'owlbt-no-client-build'),
    });
    cleanup.push(() => new Promise<void>((resolve) => result.server!.io.close(() => resolve())));

    const address = result.server!.httpServer.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${address.port}/api/dialog/pick`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'folder' }),
    });
    expect(await res.json()).toEqual({ path: '/picked/folder' });
    expect(calls).toEqual([{ kind: 'folder', initialDir: undefined }]);
  });
});

describe('host and plugin options', () => {
  const cleanup: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) {
      await fn();
    }
  });

  it('listens on 127.0.0.1 when no host is given', async () => {
    const result = await run({ port: 0, clientDist: join(tmpdir(), 'owlbt-no-client-build') });
    cleanup.push(() => new Promise<void>((resolve) => result.server!.io.close(() => resolve())));
    expect(result.server!.httpServer.address()).toMatchObject({ address: '127.0.0.1' });
  });

  it('warns about missing authentication when listening on another host', async () => {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (message?: unknown) => {
      warnings.push(String(message));
    };
    try {
      const result = await run({
        port: 0,
        host: '0.0.0.0',
        clientDist: join(tmpdir(), 'owlbt-no-client-build'),
      });
      cleanup.push(() => new Promise<void>((resolve) => result.server!.io.close(() => resolve())));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/no authentication/);
    } finally {
      console.warn = original;
    }
  });

  it('does not warn for loopback hosts', async () => {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (message?: unknown) => {
      warnings.push(String(message));
    };
    try {
      const result = await run({
        port: 0,
        host: '127.0.0.1',
        clientDist: join(tmpdir(), 'owlbt-no-client-build'),
      });
      cleanup.push(() => new Promise<void>((resolve) => result.server!.io.close(() => resolve())));
      expect(warnings).toEqual([]);
    } finally {
      console.warn = original;
    }
  });
});

describe('parseDevOptions', () => {
  it('reads --host in both forms and prefers the argument over OWLBT_HOST', () => {
    expect(parseDevOptions(['--host', '192.168.1.5'], {}).host).toBe('192.168.1.5');
    expect(parseDevOptions(['--host=192.168.1.5'], {}).host).toBe('192.168.1.5');
    expect(parseDevOptions([], { OWLBT_HOST: '10.0.0.2' }).host).toBe('10.0.0.2');
    expect(parseDevOptions(['--host', '10.0.0.3'], { OWLBT_HOST: '10.0.0.2' }).host).toBe(
      '10.0.0.3',
    );
  });

  it('keeps the default host when neither is given', () => {
    expect(parseDevOptions([], {}).host).toBeUndefined();
    expect(parseDevOptions(['--host'], {}).host).toBeUndefined();
  });

  it('enables plugin trust bypass with the flag or OWLBT_TRUST_PLUGINS=1', () => {
    expect(parseDevOptions([], {}).trustAllPlugins).toBe(false);
    expect(parseDevOptions(['--trust-plugins'], {}).trustAllPlugins).toBe(true);
    expect(parseDevOptions([], { OWLBT_TRUST_PLUGINS: '1' }).trustAllPlugins).toBe(true);
    expect(parseDevOptions([], { OWLBT_TRUST_PLUGINS: '0' }).trustAllPlugins).toBe(false);
  });
});
