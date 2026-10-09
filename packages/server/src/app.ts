import { existsSync } from 'node:fs';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { FileWatcherRegistry } from './fileWatcher';
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

  app.use('/api', createApiRouter({ picker: options.picker }));

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
  const io = new Server(httpServer);
  const registry = new FileWatcherRegistry();
  attachProjectWatch(io, registry);
  return { app, httpServer, io, registry };
}
