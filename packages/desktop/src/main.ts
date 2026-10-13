/* owl-bt desktop: the Electron main process. Runs the owl-bt server in-process and shows it in a window. */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  screen,
  shell,
  type OpenDialogOptions,
  type Rectangle,
} from 'electron';
import {
  DialogBusyError,
  run,
  type Picker,
  type PickKind,
  type PickResult,
  type RunResult,
} from '@owlbt/server';
import {
  candidatePorts,
  nextPendingRoute,
  parseWindowState,
  placementOn,
  routeFor,
  startupRoute,
  treePathFromArgs,
  type WindowState,
} from './launch';
import { Updater } from './updater';

const APP_NAME = 'owl-bt';
const HOST = '127.0.0.1';
const DEFAULT_PORT = 18955;
/** Ports tried in order: 18955 through 18975. */
const PORT_COUNT = 21;
const SMOKE_TIMEOUT_MS = 30_000;
/** First update check, a little after startup so it does not compete with loading the page. */
const UPDATE_CHECK_DELAY_MS = 5_000;

// Keeps userData at %APPDATA%/owl-bt in development too (the package name contains a slash).
app.setName(APP_NAME);

const smokeMode = process.env.OWLBT_SMOKE === '1';
const devtoolsEnabled = !app.isPackaged || process.env.OWLBT_DEVTOOLS === '1';

let origin = '';
let serverResult: RunResult | undefined;
let mainWindow: BrowserWindow | undefined;
let pickerBusy = false;
/** Route requested by a second launch before the server and window were ready. Latest wins. */
let pendingRoute: string | undefined;

/** Folder with the bundled client: resources/client when packaged, the monorepo build in development. */
function clientDistDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'client')
    : resolve(__dirname, '../../client/dist');
}

/** Folder with the server templates: resources/templates when packaged, the server package in development. */
function templatesDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'templates')
    : resolve(__dirname, '../../server/templates');
}

function windowStatePath(): string {
  return join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState(): WindowState {
  try {
    return parseWindowState(JSON.parse(readFileSync(windowStatePath(), 'utf8')));
  } catch {
    return parseWindowState(undefined);
  }
}

function saveWindowState(win: BrowserWindow): void {
  const bounds = win.getNormalBounds();
  const state: WindowState = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    maximized: win.isMaximized(),
  };
  try {
    mkdirSync(dirname(windowStatePath()), { recursive: true });
    writeFileSync(windowStatePath(), JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('owl-bt: could not save window state', err);
  }
}

function windowBounds(state: WindowState): Partial<Rectangle> {
  const areas = screen.getAllDisplays().map((display) => display.workArea);
  const position = placementOn(state, areas);
  return { width: state.width, height: state.height, ...(position ?? {}) };
}

function isLocalUrl(url: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

const updater = new Updater({ isTrustedSender: isLocalUrl, openExternal });

/** Opens http(s) links in the system browser. Other schemes are ignored. */
function openExternal(url: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      void shell.openExternal(parsed.toString());
    }
  } catch {
    // Not a URL: nothing to open.
  }
}

/** Native open dialog for the server's POST /api/dialog/pick. One dialog at a time. */
const picker: Picker = {
  async pick(kind: PickKind, initialDir?: string): Promise<PickResult> {
    if (pickerBusy) {
      throw new DialogBusyError();
    }
    pickerBusy = true;
    try {
      const options: OpenDialogOptions =
        kind === 'folder'
          ? { title: 'Select a folder with behavior trees', properties: ['openDirectory'] }
          : {
              title: 'Select a behavior tree file',
              properties: ['openFile'],
              filters: [
                { name: 'Behavior tree', extensions: ['json'] },
                { name: 'All files', extensions: ['*'] },
              ],
            };
      if (initialDir !== undefined) {
        options.defaultPath = initialDir;
      }
      const owner = mainWindow;
      const result = owner
        ? await dialog.showOpenDialog(owner, options)
        : await dialog.showOpenDialog(options);
      const [path] = result.filePaths;
      return result.canceled || path === undefined ? { cancelled: true } : { path };
    } finally {
      pickerBusy = false;
    }
  },
};

/** Resolves once the window has loaded its page; rejects when the load fails. */
function waitForLoad(win: BrowserWindow): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    win.webContents.once('did-finish-load', () => resolvePromise());
    win.webContents.once('did-fail-load', (_event, code, description) => {
      reject(new Error(`page load failed: ${code} ${description}`));
    });
  });
}

function createMainWindow(route: string): BrowserWindow {
  const state = loadWindowState();
  const win = new BrowserWindow({
    ...windowBounds(state),
    minWidth: 900,
    minHeight: 600,
    title: APP_NAME,
    autoHideMenuBar: true,
    show: false,
    backgroundColor: '#f5f6f8',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(__dirname, 'preload.cjs'),
    },
  });
  mainWindow = win;
  if (state.maximized) {
    win.maximize();
  }

  win.once('ready-to-show', () => win.show());
  // The page sets its own document title; the window keeps the app name.
  win.on('page-title-updated', (event) => event.preventDefault());
  win.on('close', () => saveWindowState(win));
  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = undefined;
    }
  });

  win.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isLocalUrl(url)) {
      event.preventDefault();
      openExternal(url);
    }
  });
  // Electron ignores the returnValue of beforeunload, so the unsaved-changes prompt is native.
  win.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Leave', 'Stay'],
      defaultId: 1,
      cancelId: 1,
      title: APP_NAME,
      message: 'You have unsaved changes. Leave anyway?',
    });
    if (choice === 0) {
      event.preventDefault(); // Ignores the page's beforeunload prompt and lets the window close.
    } else {
      updater.cancelRestart(); // "Restart to update" waits until the user closes the window.
    }
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error(`owl-bt: renderer ${details.reason}`);
  });
  if (devtoolsEnabled) {
    win.webContents.on('before-input-event', (event, input) => {
      if (
        input.type === 'keyDown' &&
        input.control &&
        input.shift &&
        input.key.toUpperCase() === 'I'
      ) {
        win.webContents.toggleDevTools();
        event.preventDefault();
      }
    });
  }

  const loaded = smokeMode ? waitForLoad(win) : undefined;
  void win.loadURL(`${origin}${route}`);
  if (loaded !== undefined) {
    void runSmoke(win, loaded);
  }
  return win;
}

/** Starts the server on the first free port in the range. Rejects when every port is taken. */
async function startServer(): Promise<RunResult> {
  if (!existsSync(join(clientDistDir(), 'index.html'))) {
    throw new Error(`the client build is missing at ${clientDistDir()}`);
  }
  process.env.OWLBT_TEMPLATES_DIR = templatesDir();
  // Plugin trust decisions live with the user profile. An explicit OWLBT_TRUST_FILE (e.g. for tests) wins.
  process.env.OWLBT_TRUST_FILE ??= join(app.getPath('userData'), 'trusted-plugins.json');

  let lastError: unknown;
  for (const port of candidatePorts(DEFAULT_PORT, PORT_COUNT)) {
    try {
      return await run({
        port,
        host: HOST,
        strictPort: true,
        clientDist: clientDistDir(),
        picker,
      });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') {
        throw err;
      }
      lastError = err;
    }
  }
  throw new Error(
    `no free port between ${DEFAULT_PORT} and ${DEFAULT_PORT + PORT_COUNT - 1} (${String(lastError)})`,
  );
}

function routeFromArgs(args: readonly string[], cwd: string): string {
  return routeFor(treePathFromArgs(args, cwd, isFile));
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function setupMenu(): void {
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }]));
  } else {
    // The editor has its own toolbar; no native menu bar on Windows and Linux.
    Menu.setApplicationMenu(null);
  }
}

// ---- Smoke test (OWLBT_SMOKE=1): load the window, query it, report and exit. ----

function finishSmoke(report: Record<string, unknown>, ok: boolean, error?: string): void {
  const out = { ...report, ok, ...(error === undefined ? {} : { error }) };
  const text = `${JSON.stringify(out, null, 2)}\n`;
  const file = process.env.OWLBT_SMOKE_OUT;
  if (file) {
    writeFileSync(file, text);
  } else {
    console.log(text);
  }
  app.exit(ok ? 0 : 1);
}

async function runSmoke(win: BrowserWindow, loaded: Promise<void>): Promise<void> {
  const report: Record<string, unknown> = { origin };
  let finished = false;
  const timer = setTimeout(() => {
    if (!finished) {
      finished = true;
      finishSmoke(report, false, `timed out after ${SMOKE_TIMEOUT_MS / 1000} s`);
    }
  }, SMOKE_TIMEOUT_MS);

  try {
    await loaded;
    report.title = await win.webContents.executeJavaScript('document.title');
    report.location = await win.webContents.executeJavaScript(
      'location.pathname + location.search',
    );
    report.bodyElements = await win.webContents.executeJavaScript(
      'document.body ? document.body.children.length : 0',
    );
    const health = (await (await fetch(`${origin}/api/health`)).json()) as unknown;
    report.health = health;
    report.indexStatus = (await fetch(`${origin}/`)).status;
    const dir = process.env.OWLBT_SMOKE_DIR;
    if (dir) {
      const ws = (await (
        await fetch(`${origin}/api/workspace?dir=${encodeURIComponent(dir)}`)
      ).json()) as { trees: unknown[]; projectPath?: string };
      report.workspaceTrees = ws.trees.length;
      report.workspaceProject = ws.projectPath ?? null;
    }
    const ok =
      typeof report.title === 'string' &&
      report.title.length > 0 &&
      typeof report.bodyElements === 'number' &&
      report.bodyElements > 0 &&
      (health as { ok?: unknown }).ok === true &&
      report.indexStatus === 200;
    clearTimeout(timer);
    if (!finished) {
      finished = true;
      finishSmoke(report, ok);
    }
  } catch (err) {
    clearTimeout(timer);
    if (!finished) {
      finished = true;
      finishSmoke(report, false, err instanceof Error ? err.message : String(err));
    }
  }
}

// ---- Startup ----

function start(): void {
  app.on('second-instance', (_event, argv, cwd) => {
    const route = routeFromArgs(argv.slice(1), cwd);
    if (serverResult === undefined) {
      // Still starting: the first window opens on the latest requested route once the server is up.
      pendingRoute = nextPendingRoute(pendingRoute, route);
      return;
    }
    const win = mainWindow;
    if (!win) {
      mainWindow = createMainWindow(route);
      return;
    }
    if (win.isMinimized()) {
      win.restore();
    }
    win.focus();
    if (route !== '/') {
      void win.loadURL(`${origin}${route}`);
    }
  });

  // macOS: a .json file dropped on the app icon or opened from Finder.
  app.on('open-file', (event, path) => {
    event.preventDefault();
    if (serverResult !== undefined) {
      if (mainWindow) {
        void mainWindow.loadURL(`${origin}${routeFor(path)}`);
      } else {
        mainWindow = createMainWindow(routeFor(path));
      }
    }
  });

  app.on('window-all-closed', () => {
    if (updater.restartRequested) {
      updater.finishRestart();
    } else if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (serverResult !== undefined && mainWindow === undefined) {
      mainWindow = createMainWindow('/');
    }
  });

  app.on('will-quit', () => {
    serverResult?.server?.io.close();
  });

  if (process.platform === 'win32') {
    app.setAppUserModelId('com.owlbt.editor');
  }

  void app
    .whenReady()
    .then(async () => {
      setupMenu();
      updater.registerIpc();
      try {
        serverResult = await startServer();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        dialog.showErrorBox(APP_NAME, `The owl-bt server could not start.\n\n${message}`);
        app.exit(1);
        return;
      }
      origin = `http://${HOST}:${serverResult.port}`;
      mainWindow = createMainWindow(
        startupRoute(pendingRoute, routeFromArgs(process.argv.slice(1), process.cwd())),
      );
      pendingRoute = undefined;
      if (!smokeMode) {
        setTimeout(() => void updater.check(), UPDATE_CHECK_DELAY_MS);
      }
    })
    .catch((err: unknown) => {
      console.error('owl-bt:', err);
      app.exit(1);
    });
}

if (app.requestSingleInstanceLock()) {
  start();
} else {
  // Another window is already running; it receives this launch through 'second-instance'.
  app.quit();
}
