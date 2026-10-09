import { promises as fsPromises, watch as fsWatch } from 'node:fs';
import type { ProjectReloadPayload } from '@owlbt/shared';

export const DEFAULT_DEBOUNCE_MS = 500;

export interface WatchHandle {
  close(): void;
}

export type WatchFn = (
  filePath: string,
  onChange: () => void,
  onError: (err: unknown) => void,
) => WatchHandle;

export type ReadFileFn = (filePath: string) => Promise<string>;

export interface FileWatcherOptions {
  watch?: WatchFn;
  readFile?: ReadFileFn;
  debounceMs?: number;
}

export type ReloadListener = (payload: ProjectReloadPayload) => void;

const defaultWatch: WatchFn = (filePath, onChange, onError) => {
  const watcher = fsWatch(filePath, () => onChange());
  watcher.on('error', onError);
  return watcher;
};

const defaultReadFile: ReadFileFn = (filePath) => fsPromises.readFile(filePath, 'utf8');

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** `{content}` when the text parses as JSON, otherwise `{error}`. */
export function toPayload(content: string): ProjectReloadPayload {
  try {
    JSON.parse(content);
    return { content };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

/** One fs watcher for one file, shared by many listeners. */
class WatchedFile {
  private readonly listeners = new Map<string, ReloadListener>();
  private handle: WatchHandle | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly filePath: string,
    private readonly opts: Required<FileWatcherOptions>,
    private readonly onEmpty: () => void,
  ) {}

  add(id: string, listener: ReloadListener): void {
    if (this.listeners.has(id)) {
      throw new Error(`duplicate listener id "${id}"`);
    }
    this.listeners.set(id, listener);
    if (!this.handle) {
      this.handle = this.opts.watch(
        this.filePath,
        () => this.schedule(),
        () => this.schedule(),
      );
    }
  }

  remove(id: string): void {
    if (!this.listeners.delete(id)) {
      return;
    }
    if (this.listeners.size === 0) {
      this.stop();
      this.onEmpty();
    }
  }

  private stop(): void {
    this.handle?.close();
    this.handle = undefined;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private schedule(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.reload();
    }, this.opts.debounceMs);
  }

  private async reload(): Promise<void> {
    let payload: ProjectReloadPayload;
    try {
      payload = toPayload(await this.opts.readFile(this.filePath));
    } catch (e) {
      payload = { error: errorMessage(e) };
    }
    for (const listener of [...this.listeners.values()]) {
      try {
        listener(payload);
      } catch (e) {
        console.error(e);
      }
    }
  }
}

/**
 * Registry of file watchers keyed by file path. A watcher is started when the first
 * listener is added for a file and closed when the last one is removed.
 */
export class FileWatcherRegistry {
  private readonly files = new Map<string, WatchedFile>();
  private readonly opts: Required<FileWatcherOptions>;

  constructor(options: FileWatcherOptions = {}) {
    this.opts = {
      watch: options.watch ?? defaultWatch,
      readFile: options.readFile ?? defaultReadFile,
      debounceMs: options.debounceMs ?? DEFAULT_DEBOUNCE_MS,
    };
  }

  addListener(filePath: string, id: string, callback: ReloadListener): void {
    let file = this.files.get(filePath);
    if (!file) {
      const created: WatchedFile = new WatchedFile(filePath, this.opts, () => {
        if (this.files.get(filePath) === created) {
          this.files.delete(filePath);
        }
      });
      file = created;
      this.files.set(filePath, created);
    }
    file.add(id, callback);
  }

  removeListener(filePath: string, id: string): void {
    this.files.get(filePath)?.remove(id);
  }

  /** Number of files currently watched. */
  get watchedCount(): number {
    return this.files.size;
  }
}
