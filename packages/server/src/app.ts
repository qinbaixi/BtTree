import { existsSync } from 'node:fs';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { FileWatcherRegistry } from './fileWatcher';
import { allowedHostnames, localGuard, socketRequestAllowed } from './localGuard';
import type { Picker } from './picker';
import { apiErrorHandler, createApiRouter } from './routes';
import { attachProjectWatch } from './socket';

const moduleDir = dirname(fileURLToPath(import.meta.url));

/** Client build of the monorepo (development layout: packages/server/{src,dist} -> packages/client/dist). */
export const DEFAULT_CLIENT_DIST = resolve(moduleDir, '../../client/dist');

/** Client build copied into the server bundle by scripts/copy-client.mjs (published layout). */
export const BUNDLED_CLIENT_DIST = join(moduleDir, 'public');

export interface AppOptions {
  /** Directory with the client build. Defaults to OWLBT_CLIENT_DIST, then the bundled client, then the monorepo build. */
  clientDist?: string;
  /** Native file dialog runner used by POST /api/dialog/pick. Defaults to the platform picker. */
  picker?: Picker;
  /**
   * Hostnames besides localhost, 127.0.0.1 and [::1] that requests may use (Host and Origin). Set when
   * the server listens on another interface, e.g. `--host 192.168.1.5`.
   */
  allowedHosts?: string[];
  /** Runs owl-bt.js plugins without the trust check (the --trust-plugins flag). */
  trustAllPlugins?: boolean;
}

export function resolveClientDist(options: AppOptions = {}): string {
  const explicit = options.clientDist ?? (process.env.OWLBT_CLIENT_DIST || undefined);
  if (explicit !== undefined) {
    return resolve(explicit);
  }
  return existsSync(BUNDLED_CLIENT_DIST) ? BUNDLED_CLIENT_DIST : DEFAULT_CLIENT_DIST;
}

export function createApp(options: AppOptions = {}): express.Express {
  const app = express();
  app.disable('x-powered-by');

  // Host and Origin checks cover every route, including the static client.
  app.use(localGuard(allowedHostnames(options.allowedHosts)));
  app.use(
    '/api',
    createApiRouter({ picker: options.picker, trustAllPlugins: options.trustAllPlugins }),
  );

  const clientDist = resolveClientDist(options);
  const indexHtml = join(clientDist, 'index.html');
  if (existsSync(indexHtml)) {
    app.use(express.static(clientDist));
    // SPA fallback: any GET outside /api serves the client entry point.
    app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
      res.sendFile(indexHtml);
    });
  }

  app.use(apiErrorHandler);
  return app;
}

export interface ServerBundle {
  app: express.Express;
  httpServer: HttpServer;
  io: Server;
  registry: FileWatcherRegistry;
}

export function createServer(options: AppOptions = {}): ServerBundle {
  const app = createApp(options);
  const httpServer = createHttpServer(app);
  const allowed = allowedHostnames(options.allowedHosts);
  const io = new Server(httpServer, {
    allowRequest: (req, callback) => {
      callback(null, socketRequestAllowed(req, allowed));
    },
  });
  const registry = new FileWatcherRegistry();
  attachProjectWatch(io, registry);
  return { app, httpServer, io, registry };
}
