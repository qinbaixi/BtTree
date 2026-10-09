import { createServer, type ServerBundle } from './app';
import { getPort } from './config';

export interface RunOptions {
  /** Defaults to getPort(). */
  port?: number;
  clientDist?: string;
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

/** Starts the HTTP + socket.io server. Rejects on errors other than EADDRINUSE. */
export function run(options: RunOptions = {}): Promise<RunResult> {
  const port = options.port ?? getPort();
  const bundle = createServer({ clientDist: options.clientDist });
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
      if (err.code === 'EADDRINUSE') {
        finish(true);
      } else {
        reject(err);
      }
    };

    httpServer.once('error', onStartError);
    httpServer.listen(port, () => {
      httpServer.off('error', onStartError);
      httpServer.on('error', (err) => {
        console.error(err);
      });
      finish(false);
    });
  });
}
