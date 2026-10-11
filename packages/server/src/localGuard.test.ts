import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { io as connect, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, createServer, type ServerBundle } from './app';
import {
  allowedHostnames,
  hostnameOf,
  isAllowedHost,
  isAllowedOrigin,
  isLoopbackHost,
  normalizeHostname,
  socketRequestAllowed,
} from './localGuard';

describe('host helpers', () => {
  it('recognises loopback hosts and nothing else', () => {
    for (const host of ['localhost', '127.0.0.1', '127.0.0.2', '::1', '[::1]', 'LOCALHOST']) {
      expect(isLoopbackHost(host)).toBe(true);
    }
    for (const host of ['0.0.0.0', '192.168.1.5', '::', 'example.com']) {
      expect(isLoopbackHost(host)).toBe(false);
    }
  });

  it('normalises IPv6 literals to bracketed lower case', () => {
    expect(normalizeHostname('FE80::1')).toBe('[fe80::1]');
    expect(normalizeHostname('[::1]')).toBe('[::1]');
    expect(normalizeHostname(' Example.COM ')).toBe('example.com');
  });

  it('takes the hostname of Host and Origin values without the port', () => {
    expect(hostnameOf('localhost:9000', 'host')).toBe('localhost');
    expect(hostnameOf('[::1]:9000', 'host')).toBe('[::1]');
    expect(hostnameOf('http://localhost:5173', 'origin')).toBe('localhost');
    expect(hostnameOf('http://127.0.0.1:18955', 'origin')).toBe('127.0.0.1');
    // Userinfo tricks resolve to the real host, which is then refused.
    expect(hostnameOf('127.0.0.1@evil.example', 'host')).toBeUndefined();
    expect(hostnameOf('null', 'origin')).toBeUndefined();
  });

  it('allows the configured hosts in addition to loopback', () => {
    const allowed = allowedHostnames(['192.168.1.5']);
    expect(isAllowedHost('192.168.1.5:9000', allowed)).toBe(true);
    expect(isAllowedHost('localhost:9000', allowed)).toBe(true);
    expect(isAllowedHost('evil.example', allowed)).toBe(false);
    expect(isAllowedHost(undefined, allowed)).toBe(false);
  });

  it('accepts a missing Origin and checks the hostname of a present one', () => {
    const allowed = allowedHostnames();
    expect(isAllowedOrigin(undefined, allowed)).toBe(true);
    expect(isAllowedOrigin('http://localhost:5173', allowed)).toBe(true);
    expect(isAllowedOrigin('http://evil.example', allowed)).toBe(false);
    expect(isAllowedOrigin('null', allowed)).toBe(false);
  });

  it('applies the Host and Origin rules to socket requests', () => {
    const allowed = allowedHostnames();
    const req = (headers: Record<string, string>) => ({ headers }) as unknown as IncomingMessage;
    expect(socketRequestAllowed(req({ host: '127.0.0.1:9000' }), allowed)).toBe(true);
    expect(
      socketRequestAllowed(
        req({ host: '127.0.0.1:9000', origin: 'http://localhost:5173' }),
        allowed,
      ),
    ).toBe(true);
    expect(
      socketRequestAllowed(req({ host: '127.0.0.1:9000', origin: 'http://evil.example' }), allowed),
    ).toBe(false);
    expect(socketRequestAllowed(req({ host: 'evil.example' }), allowed)).toBe(false);
  });
});

describe('Host and Origin checks on HTTP routes', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'owlbt-guard-'));
    writeFileSync(join(dir, 'index.html'), '<html>spa-shell</html>');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const app = (allowedHosts?: string[]) => createApp({ clientDist: dir, allowedHosts });

  it('serves requests whose Host is localhost, 127.0.0.1 or [::1], whatever the port', async () => {
    for (const host of ['localhost:9000', '127.0.0.1:18955', '[::1]:8955', 'localhost']) {
      const res = await request(app()).get('/api/health').set('Host', host);
      expect(res.status).toBe(200);
    }
  });

  it('refuses other Host names with 403 on API and static routes', async () => {
    const api = await request(app()).get('/api/health').set('Host', 'evil.example');
    expect(api.status).toBe(403);
    expect(api.text).toBe('Forbidden host');

    const page = await request(app()).get('/').set('Host', 'evil.example:9000');
    expect(page.status).toBe(403);
    expect(page.text).toBe('Forbidden host');
  });

  it('serves the configured extra host and refuses it without the option', async () => {
    expect(
      (
        await request(app(['192.168.1.5']))
          .get('/api/health')
          .set('Host', '192.168.1.5:8955')
      ).status,
    ).toBe(200);
    expect((await request(app()).get('/api/health').set('Host', '192.168.1.5:8955')).status).toBe(
      403,
    );
  });

  it('refuses unsafe requests from another Origin with 403', async () => {
    const res = await request(app())
      .post('/api/dialog/pick')
      .set('Origin', 'http://evil.example')
      .set('Content-Type', 'application/json')
      .send({ kind: 'folder' });
    expect(res.status).toBe(403);
    expect(res.text).toBe('Forbidden origin');
  });

  it('allows unsafe requests from a loopback Origin and without any Origin', async () => {
    const withOrigin = await request(app())
      .post('/api/project/init')
      .set('Origin', 'http://localhost:5173')
      .set('Content-Type', 'application/json')
      .send({});
    // Past the guard: the handler rejects the empty body.
    expect(withOrigin.status).toBe(400);

    const curl = await request(app())
      .post('/api/project/init')
      .set('Content-Type', 'application/json')
      .send({});
    expect(curl.status).toBe(400);
  });

  it('does not check Origin on safe methods', async () => {
    const res = await request(app()).get('/api/health').set('Origin', 'http://evil.example');
    expect(res.status).toBe(200);
  });
});

describe('socket.io Host and Origin checks', () => {
  let root: string;
  let server: ServerBundle;
  let port: number;
  const sockets: Socket[] = [];

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'owlbt-guard-socket-'));
    server = createServer({ clientDist: join(root, 'no-client-build') });
    await new Promise<void>((resolve) => server.httpServer.listen(0, '127.0.0.1', () => resolve()));
    port = (server.httpServer.address() as AddressInfo).port;
  });

  afterEach(async () => {
    for (const socket of sockets.splice(0)) {
      socket.disconnect();
    }
    await new Promise<void>((resolve) => server.io.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  });

  /** Resolves with 'connected' or the connect error message. */
  function attempt(headers: Record<string, string>): Promise<string> {
    const socket = connect(`http://127.0.0.1:${port}/prj-watch`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      query: {},
      extraHeaders: headers,
    });
    sockets.push(socket);
    return new Promise((resolve) => {
      socket.once('connect', () => resolve('connected'));
      socket.once('connect_error', (err: Error) => resolve(`error: ${err.message}`));
    });
  }

  it('accepts a connection from a loopback Origin', async () => {
    expect(await attempt({ Origin: 'http://localhost:5173' })).toBe('connected');
  });

  it('accepts a connection without an Origin header', async () => {
    expect(await attempt({})).toBe('connected');
  });

  it('rejects a connection from another Origin', async () => {
    expect(await attempt({ Origin: 'http://evil.example' })).toMatch(/^error:/);
  });
});
