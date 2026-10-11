import { createServer, type ServerBundle } from './app';
import { getPort } from './config';
import type { Picker } from './picker';

export interface RunOptions {
  /** Defaults to getPort(). */
  port?: number;
  /** Interface to listen on. Defaults to all interfaces (Node's default). */
  host?: string;
  /**
   * When true, a busy port rejects with EADDRINUSE instead of being treated as "already running".
   * Used by the desktop app, which must own its port.
   */
  strictPort?: boolean;
  clientDist?: string;
  /** Native file dialog runner for POST /api/dialog/pick. Defaults to the platform picker. */
  picker?: Picker;
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
  const bundle = createServer({ clientDist: options.clientDist, picker: options.picker });
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
    if (options.host === undefined) {
      httpServer.listen(port, onListen);
    } else {
      httpServer.listen(port, options.host, onListen);
    }
  });
}
