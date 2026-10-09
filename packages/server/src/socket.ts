import { isAbsolute } from 'node:path';
import type { ProjectReloadPayload } from '@owlbt/shared';
import type { Server } from 'socket.io';
import type { FileWatcherRegistry } from './fileWatcher';
import { findProjectFile } from './project';

export const PROJECT_WATCH_NAMESPACE = '/prj-watch';
export const PROJECT_RELOAD_EVENT = 'prj-reload';

/** Decodes the `treePath` handshake value; malformed escapes are kept as-is. */
export function readTreePathQuery(value: unknown): string | undefined {
  if (typeof value !== 'string' || value === '') {
    return undefined;
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Sends `prj-reload` to each client whenever the project file of its tree changes.
 * Clients whose tree has no project get a single `{error}` payload.
 */
export function attachProjectWatch(io: Server, registry: FileWatcherRegistry): void {
  io.of(PROJECT_WATCH_NAMESPACE).on('connection', (socket) => {
    let watchedFile: string | undefined;
    let disconnected = false;

    socket.on('disconnect', () => {
      disconnected = true;
      if (watchedFile !== undefined) {
        registry.removeListener(watchedFile, socket.id);
      }
    });

    const fail = (error: string): void => {
      const payload: ProjectReloadPayload = { error };
      socket.emit(PROJECT_RELOAD_EVENT, payload);
    };

    const treePath = readTreePathQuery(socket.handshake.query.treePath);
    if (treePath === undefined) {
      fail('No project found');
      return;
    }
    if (!isAbsolute(treePath)) {
      fail('Path must be absolute');
      return;
    }

    void (async () => {
      let projectPath: string | undefined;
      try {
        projectPath = await findProjectFile(treePath);
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err));
        return;
      }
      if (disconnected) {
        return;
      }
      if (projectPath === undefined) {
        fail('No project found');
        return;
      }
      watchedFile = projectPath;
      registry.addListener(projectPath, socket.id, (payload) => {
        socket.emit(PROJECT_RELOAD_EVENT, payload);
      });
    })();
  });
}
