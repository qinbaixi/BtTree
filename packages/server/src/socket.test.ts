import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { ProjectReloadPayload } from '@owlbt/shared';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type ServerBundle } from './app';
import { readTreePathQuery } from './socket';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function waitForEvent(socket: Socket, timeoutMs: number): Promise<ProjectReloadPayload> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for prj-reload')), timeoutMs);
    socket.once('prj-reload', (payload: ProjectReloadPayload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function waitForConnect(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
  });
}

describe('/prj-watch socket namespace', () => {
  let root: string;
  let server: ServerBundle;
  let port: number;
  const sockets: Socket[] = [];

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'owlbt-socket-'));
    mkdirSync(join(root, 'trees'), { recursive: true });
    writeFileSync(join(root, 'owl-bt.json'), '{"nodes":[]}');
    writeFileSync(join(root, 'trees', 'tree.json'), '{"type":"Selector"}');

    server = createServer({ clientDist: join(root, 'no-client-build') });
    await new Promise<void>((resolve) => server.httpServer.listen(0, '127.0.0.1', () => resolve()));
    port = (server.httpServer.address() as AddressInfo).port;
  });

  afterEach(async () => {
    for (const s of sockets.splice(0)) {
      s.disconnect();
    }
    await new Promise<void>((resolve) => server.io.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  });

  function open(treePath: string | undefined): Socket {
    const socket = connect(`http://127.0.0.1:${port}/prj-watch`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      query: treePath === undefined ? {} : { treePath },
    });
    sockets.push(socket);
    return socket;
  }

  it('emits prj-reload with the new content after the project file changes', async () => {
    const socket = open(join(root, 'trees', 'tree.json'));
    await waitForConnect(socket);
    // Give the server a moment to resolve the project and register the watcher.
    await sleep(300);

    const next = '{"nodes":[{"name":"Changed"}]}';
    const reload = waitForEvent(socket, 15000);
    writeFileSync(join(root, 'owl-bt.json'), next);

    expect(await reload).toEqual({ content: next });
  });

  it('emits an error when no project exists for the tree', async () => {
    const isolated = mkdtempSync(join(tmpdir(), 'owlbt-noproj-'));
    try {
      const socket = open(join(isolated, 'tree.json'));
      const payload = await waitForEvent(socket, 10000);
      expect(payload).toEqual({ error: 'No project found' });
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
  });

  it('emits an error when no treePath is given', async () => {
    const socket = open(undefined);
    expect(await waitForEvent(socket, 10000)).toEqual({ error: 'No project found' });
  });

  it('removes its watcher listener on disconnect', async () => {
    const socket = open(join(root, 'trees', 'tree.json'));
    await waitForConnect(socket);
    await sleep(300);
    expect(server.registry.watchedCount).toBe(1);

    socket.disconnect();
    const deadline = Date.now() + 5000;
    while (server.registry.watchedCount !== 0 && Date.now() < deadline) {
      await sleep(50);
    }
    expect(server.registry.watchedCount).toBe(0);
  });
});

describe('readTreePathQuery', () => {
  it('decodes escapes and keeps malformed input', () => {
    expect(readTreePathQuery('C%3A%5Cproj%5Ctree.json')).toBe('C:\\proj\\tree.json');
    expect(readTreePathQuery('100%')).toBe('100%');
    expect(readTreePathQuery(undefined)).toBeUndefined();
    expect(readTreePathQuery('')).toBeUndefined();
    expect(readTreePathQuery(['a'])).toBeUndefined();
  });
});
