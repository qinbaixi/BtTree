/**
 * Update check for the desktop app. The check asks GitHub for the newest release; the Windows installer
 * build (and the Linux AppImage) then downloads it with electron-updater and installs it when the app
 * restarts. Other builds (portable exe, macOS, development) open the release page instead.
 */
import { app, BrowserWindow, ipcMain, net, type IpcMainInvokeEvent } from 'electron';
import { autoUpdater } from 'electron-updater';
import {
  isNewerVersion,
  parseLatestRelease,
  RELEASE_REPO,
  RELEASES_URL,
  type AppUpdateState,
} from '@owlbt/shared';
import { canInstallUpdates } from './launch';
import { UPDATE_CHANNELS } from './updateChannels';

const LATEST_RELEASE_API = `https://api.github.com/repos/${RELEASE_REPO}/releases/latest`;
const CHECK_TIMEOUT_MS = 15_000;

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface UpdaterOptions {
  /** Pages allowed to call the update API (the app's own server). */
  isTrustedSender(url: string): boolean;
  openExternal(url: string): void;
}

export class Updater {
  private state: AppUpdateState;
  private checking: Promise<AppUpdateState> | undefined;
  private updaterReady = false;
  /** Set when the page asked to restart; the restart happens once every window has closed. */
  restartRequested = false;

  constructor(private readonly options: UpdaterOptions) {
    this.state = {
      status: 'idle',
      currentVersion: app.getVersion(),
      canInstall: canInstallUpdates(app.isPackaged, process.platform, process.env),
    };
  }

  getState(): AppUpdateState {
    return this.state;
  }

  private set(next: Partial<AppUpdateState>): AppUpdateState {
    this.state = { ...this.state, ...next };
    if (this.state.status !== 'downloading') {
      delete this.state.percent;
    }
    if (this.state.status !== 'error') {
      delete this.state.error;
    }
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(UPDATE_CHANNELS.state, this.state);
      }
    }
    return this.state;
  }

  /** Asks GitHub for the newest release. A download in progress or finished is kept. */
  check(): Promise<AppUpdateState> {
    if (this.state.status === 'downloading' || this.state.status === 'downloaded') {
      return Promise.resolve(this.state);
    }
    this.checking ??= this.runCheck().finally(() => {
      this.checking = undefined;
    });
    return this.checking;
  }

  private async runCheck(): Promise<AppUpdateState> {
    this.set({ status: 'checking' });
    try {
      const response = await net.fetch(LATEST_RELEASE_API, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'owl-bt' },
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      });
      if (response.status === 404) {
        // No published release yet.
        return this.set({ status: 'latest', latestVersion: undefined, releaseUrl: RELEASES_URL });
      }
      if (!response.ok) {
        throw new Error(`GitHub answered ${response.status} ${response.statusText}`.trim());
      }
      const release = parseLatestRelease(await response.json());
      if (!release) {
        throw new Error('the latest release has no version tag');
      }
      const newer = isNewerVersion(release.version, this.state.currentVersion);
      return this.set({
        status: newer ? 'available' : 'latest',
        latestVersion: release.version,
        releaseUrl: release.url,
      });
    } catch (err) {
      return this.set({ status: 'error', error: `Could not check for updates: ${message(err)}` });
    }
  }

  /** Downloads the newer release, or opens its page when this build cannot install it. */
  async download(): Promise<AppUpdateState> {
    if (this.state.status !== 'available') {
      return this.state;
    }
    if (!this.state.canInstall) {
      this.options.openExternal(this.state.releaseUrl ?? RELEASES_URL);
      return this.state;
    }
    this.setupUpdater();
    this.set({ status: 'downloading', percent: 0 });
    try {
      const result = await autoUpdater.checkForUpdates();
      if (!result?.isUpdateAvailable) {
        throw new Error('the release has no installer for this system yet');
      }
      this.set({ latestVersion: result.updateInfo.version });
      await autoUpdater.downloadUpdate();
      return this.set({ status: 'downloaded' });
    } catch (err) {
      return this.set({ status: 'error', error: `Could not download the update: ${message(err)}` });
    }
  }

  private setupUpdater(): void {
    if (this.updaterReady) {
      return;
    }
    this.updaterReady = true;
    autoUpdater.autoDownload = false;
    // A downloaded update is installed the next time the app quits, even without "Restart now".
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = null;
    autoUpdater.on('download-progress', (progress: { percent: number }) => {
      if (this.state.status === 'downloading') {
        this.set({ percent: Math.max(0, Math.min(100, Math.round(progress.percent))) });
      }
    });
  }

  /**
   * Closes every window so that unsaved changes are asked about; the main process restarts into the
   * update once they have all closed (see `finishRestart`).
   */
  requestRestart(): void {
    if (this.state.status !== 'downloaded') {
      return;
    }
    this.restartRequested = true;
    for (const win of BrowserWindow.getAllWindows()) {
      win.close();
    }
  }

  /** The user kept a window open (unsaved changes): forget the restart. */
  cancelRestart(): void {
    this.restartRequested = false;
  }

  /** Quits, installs the downloaded update silently and starts the new version. */
  finishRestart(): void {
    autoUpdater.quitAndInstall(true, true);
  }

  registerIpc(): void {
    const guard =
      <T>(handler: () => T) =>
      (event: IpcMainInvokeEvent): T => {
        const url = event.senderFrame?.url ?? '';
        if (!this.options.isTrustedSender(url)) {
          throw new Error('not allowed');
        }
        return handler();
      };
    ipcMain.handle(
      UPDATE_CHANNELS.get,
      guard(() => this.state),
    );
    ipcMain.handle(
      UPDATE_CHANNELS.check,
      guard(() => this.check()),
    );
    ipcMain.handle(
      UPDATE_CHANNELS.download,
      guard(() => this.download()),
    );
    ipcMain.handle(
      UPDATE_CHANNELS.install,
      guard(() => this.requestRestart()),
    );
  }
}
