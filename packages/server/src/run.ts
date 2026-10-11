import { createServer, type ServerBundle } from './app';
import { getPort } from './config';
import { isLoopbackHost } from './localGuard';
import type { Picker } from './picker';

/** Interface used when no host is given: this machine only. */
export const DEFAULT_HOST = '127.0.0.1';

export interface RunOptions {
  /** Defaults to getPort(). */
  port?: number;
  /**
   * Interface to listen on. Defaults to 127.0.0.1, so only this machine can connect. Any other host
   * prints a warning: the API has no authentication.
   */
  host?: string;
  /**
   * When true, a busy port rejects with EADDRINUSE instead of being treated as "already running".
   * Used by the desktop app, which must own its port.
   */
  strictPort?: boolean;
  clientDist?: string;
  /** Native file dialog runner for POST /api/dialog/pick. Defaults to the platform picker. */
  picker?: Picker;
  /** Runs owl-bt.js plugins without the trust check (see pluginTrust.ts). */
  trustAllPlugins?: boolean;
  /**
   * Called once listening. `reused: true` means the port is already held by another
   * instance, which is treated as success.
   */
  onListening?: (info: { port: number; reused: boolean }) => void;
}

export interface RunResult {
  port: number;
  /** True when the port was already in use (another instance is serving). */
  reused: boolean;
  /** The server started by this call; undefined when reused. */
  server?: ServerBundle;
}

/** Starts the HTTP + socket.io server. Rejects on errors other than EADDRINUSE (and on EADDRINUSE with strictPort). */
export function run(options: RunOptions = {}): Promise<RunResult> {
  const port = options.port ?? getPort();
  const host = options.host ?? DEFAULT_HOST;
  const loopback = isLoopbackHost(host);
  if (!loopback) {
    console.warn(
      `owl-bt: warning: listening on ${host} makes the API reachable from other machines. The API has no authentication, so anyone who can reach it can read and change the files it serves.`,
    );
  }
  const bundle = createServer({
    clientDist: options.clientDist,
    picker: options.picker,
    trustAllPlugins: options.trustAllPlugins,
    // Other hosts must be named in the Host header; loopback names are always allowed.
    allowedHosts: loopback ? undefined : [host],
  });
  const { httpServer } = bundle;

  return new Promise<RunResult>((resolvePromise, reject) => {
    const finish = (reused: boolean): void => {
      const address = httpServer.address();
      const actualPort = !reused && typeof address === 'object' && address ? address.port : port;
      options.onListening?.({ port: actualPort, reused });
      resolvePromise(
        reused ? { port: actualPort, reused } : { port: actualPort, reused, server: bundle },
      );
    };

    const onStartError = (err: NodeJS.ErrnoException): void => {
      if (err.code === 'EADDRINUSE' && !options.strictPort) {
        finish(true);
      } else {
        reject(err);
      }
    };

    const onListen = (): void => {
      httpServer.off('error', onStartError);
      httpServer.on('error', (err) => {
        console.error(err);
      });
      finish(false);
    };

    httpServer.once('error', onStartError);
    httpServer.listen(port, host, onListen);
  });
}
