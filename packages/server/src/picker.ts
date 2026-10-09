import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { isErrno } from './errors';

export type PickKind = 'folder' | 'file';
export type PickResult = { path: string } | { cancelled: true };

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** True when the process was killed because it ran longer than the timeout. */
  timedOut: boolean;
}

export interface CommandOptions {
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
}

/**
 * Runs a program without a shell. Resolves for every program that starts (whatever its exit code);
 * rejects when it cannot be started, e.g. with ENOENT.
 */
export type RunCommand = (
  file: string,
  args: string[],
  options: CommandOptions,
) => Promise<CommandResult>;

export interface Picker {
  pick(kind: PickKind, initialDir?: string): Promise<PickResult>;
}

export interface PickerOptions {
  /** Defaults to process.platform. */
  platform?: NodeJS.Platform;
  /** Defaults to the execFile-based runCommand. Injected in tests. */
  run?: RunCommand;
  /** Defaults to DIALOG_TIMEOUT_MS. */
  timeoutMs?: number;
}

export const DIALOG_TIMEOUT_MS = 10 * 60 * 1000;

const FOLDER_TITLE = 'Select a folder with behavior trees';
const FILE_TITLE = 'Select a behavior tree file';
const NO_DIALOG_MESSAGE =
  'No native file dialog is available on this system (on Linux, install zenity or kdialog).';
const CANCELLED: PickResult = { cancelled: true };

export class DialogUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DialogUnsupportedError';
  }
}

export class DialogBusyError extends Error {
  constructor() {
    super('A dialog is already open');
    this.name = 'DialogBusyError';
  }
}

export const runCommand: RunCommand = (file, args, { env, timeoutMs }) =>
  new Promise((resolvePromise, reject) => {
    execFile(
      file,
      args,
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
        env: env ? { ...process.env, ...env } : process.env,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolvePromise({ stdout, stderr, exitCode: 0, timedOut: false });
          return;
        }
        if (error.killed) {
          resolvePromise({ stdout, stderr, exitCode: -1, timedOut: true });
          return;
        }
        if (typeof error.code === 'number') {
          resolvePromise({ stdout, stderr, exitCode: error.code, timedOut: false });
          return;
        }
        reject(error);
      },
    );
  });

/** One way to show a dialog. `interpret` maps the finished process to a result or throws. */
interface DialogCommand {
  file: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  interpret(result: CommandResult): PickResult;
}

/** The output without its trailing line break, or undefined when there is no output. */
function pathFromOutput(stdout: string): string | undefined {
  const line = stdout.replace(/[\r\n]+$/, '');
  return line === '' ? undefined : line;
}

function failure(result: CommandResult): Error {
  const detail = result.stderr.trim();
  return new Error(
    `File dialog failed with exit code ${result.exitCode}${detail ? `: ${detail}` : ''}`,
  );
}

/**
 * Explorer-style folder picker (IFileOpenDialog with FOS_PICKFOLDERS). Windows PowerShell 5.1 runs on
 * .NET Framework, whose FolderBrowserDialog is the old tree-view dialog. Passed to Add-Type via the
 * environment so the script stays free of interpolated content.
 */
const WINDOWS_FOLDER_DIALOG_CS = `
using System;
using System.Runtime.InteropServices;
public static class OwlbtFolderPicker {
  [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")] class FileOpenDialogCoClass {}
  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItem {
    void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
    void GetParent(out IShellItem ppsi);
    void GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
    void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
    void Compare(IShellItem psi, uint hint, out int piOrder);
  }
  [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IFileDialog {
    [PreserveSig] int Show(IntPtr parent);
    void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
    void SetFileTypeIndex(uint iFileType);
    void GetFileTypeIndex(out uint piFileType);
    void Advise(IntPtr pfde, out uint pdwCookie);
    void Unadvise(uint dwCookie);
    void SetOptions(uint fos);
    void GetOptions(out uint pfos);
    void SetDefaultFolder(IShellItem psi);
    void SetFolder(IShellItem psi);
    void GetFolder(out IShellItem ppsi);
    void GetCurrentSelection(out IShellItem ppsi);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
    void GetResult(out IShellItem ppsi);
  }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern void SHCreateItemFromParsingName(string pszPath, IntPtr pbc, ref Guid riid, out IShellItem ppv);
  const uint FOS_PICKFOLDERS = 0x20, FOS_FORCEFILESYSTEM = 0x40, SIGDN_FILESYSPATH = 0x80058000;
  const int ERROR_CANCELLED = unchecked((int)0x800704C7);
  public static string Pick(IntPtr owner, string title, string start) {
    IFileDialog dialog = (IFileDialog)new FileOpenDialogCoClass();
    uint options;
    dialog.GetOptions(out options);
    dialog.SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM);
    dialog.SetTitle(title);
    if (!String.IsNullOrEmpty(start)) {
      try {
        Guid iid = typeof(IShellItem).GUID;
        IShellItem folder;
        SHCreateItemFromParsingName(start, IntPtr.Zero, ref iid, out folder);
        dialog.SetFolder(folder);
      } catch (Exception) {}
    }
    int hr = dialog.Show(owner);
    if (hr == ERROR_CANCELLED) return null;
    if (hr != 0) Marshal.ThrowExceptionForHR(hr);
    IShellItem result;
    dialog.GetResult(out result);
    string path;
    result.GetDisplayName(SIGDN_FILESYSPATH, out path);
    return path;
  }
}
`;

// A transparent top-most owner window, shown and activated so the dialog opens in front of the browser.
const WINDOWS_SETUP = [
  '$ErrorActionPreference=\'Stop\'',
  '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8',
  'Add-Type -AssemblyName System.Windows.Forms',
  "$f=New-Object System.Windows.Forms.Form -Property @{TopMost=$true; ShowInTaskbar=$false; Opacity=0; FormBorderStyle='None'; StartPosition='CenterScreen'; Width=1; Height=1}",
  '$f.Show()',
  '$f.Activate()',
  '$start=$env:OWLBT_INITIAL_DIR',
  '$hasStart=[bool]$start -and (Test-Path -LiteralPath $start -PathType Container)',
].join('; ');

const WINDOWS_FOLDER_SCRIPT = [
  WINDOWS_SETUP,
  'Add-Type -TypeDefinition $env:OWLBT_PICKER_CS',
  `$p=[OwlbtFolderPicker]::Pick($f.Handle, '${FOLDER_TITLE}', $(if($hasStart){$start}else{''}))`,
  'if($p){Write-Output $p}',
  '$f.Dispose()',
].join('; ');

const WINDOWS_FILE_SCRIPT = [
  WINDOWS_SETUP,
  '$d=New-Object System.Windows.Forms.OpenFileDialog',
  `$d.Title='${FILE_TITLE}'`,
  "$d.Filter='Behavior tree (*.json)|*.json|All files (*.*)|*.*'",
  'if($hasStart){$d.InitialDirectory=$start}',
  'if($d.ShowDialog($f) -eq [System.Windows.Forms.DialogResult]::OK){Write-Output $d.FileName}',
  '$f.Dispose()',
].join('; ');

function interpretWindows(result: CommandResult): PickResult {
  if (result.timedOut) {
    return CANCELLED;
  }
  if (result.exitCode !== 0) {
    throw failure(result);
  }
  const path = pathFromOutput(result.stdout);
  return path === undefined ? CANCELLED : { path };
}

function escapeAppleScript(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function stripTrailingSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

function interpretMac(result: CommandResult): PickResult {
  if (result.timedOut) {
    return CANCELLED;
  }
  if (result.exitCode === 0) {
    const path = pathFromOutput(result.stdout);
    return path === undefined ? CANCELLED : { path: stripTrailingSlash(path) };
  }
  // osascript reports a cancelled dialog as error -128 "User canceled." with exit code 1.
  if (/user canceled|\(-128\)/i.test(result.stderr)) {
    return CANCELLED;
  }
  throw failure(result);
}

/** zenity and kdialog: exit code 1 without output means the user cancelled. */
function interpretZenityLike(result: CommandResult): PickResult {
  if (result.timedOut) {
    return CANCELLED;
  }
  const path = pathFromOutput(result.stdout);
  if (path !== undefined && result.exitCode === 0) {
    return { path };
  }
  if (path === undefined && (result.exitCode === 0 || result.exitCode === 1)) {
    return CANCELLED;
  }
  throw failure(result);
}

function withTrailingSlash(dir: string): string {
  return dir.endsWith('/') ? dir : `${dir}/`;
}

function commandsFor(
  platform: NodeJS.Platform,
  kind: PickKind,
  initialDir: string | undefined,
): DialogCommand[] {
  const title = kind === 'folder' ? FOLDER_TITLE : FILE_TITLE;

  switch (platform) {
    case 'win32':
      return [
        {
          file: 'powershell.exe',
          args: [
            '-NoProfile',
            '-STA',
            '-Command',
            kind === 'folder' ? WINDOWS_FOLDER_SCRIPT : WINDOWS_FILE_SCRIPT,
          ],
          // The start folder goes through the environment, never through string interpolation.
          env: {
            OWLBT_INITIAL_DIR: initialDir ?? '',
            ...(kind === 'folder' ? { OWLBT_PICKER_CS: WINDOWS_FOLDER_DIALOG_CS } : {}),
          },
          interpret: interpretWindows,
        },
      ];

    case 'darwin': {
      const prompt = `with prompt "${escapeAppleScript(title)}"`;
      const location = initialDir
        ? ` default location POSIX file "${escapeAppleScript(initialDir)}"`
        : '';
      const chooser =
        kind === 'folder'
          ? `choose folder ${prompt}${location}`
          : `choose file ${prompt}${location} of type {"json"}`;
      return [
        {
          file: 'osascript',
          args: ['-e', `POSIX path of (${chooser})`],
          interpret: interpretMac,
        },
      ];
    }

    case 'linux': {
      const start = initialDir ?? homedir();
      if (kind === 'folder') {
        return [
          {
            file: 'zenity',
            args: [
              '--file-selection',
              '--directory',
              `--title=${title}`,
              `--filename=${withTrailingSlash(start)}`,
            ],
            interpret: interpretZenityLike,
          },
          {
            file: 'kdialog',
            args: ['--title', title, '--getexistingdirectory', start],
            interpret: interpretZenityLike,
          },
        ];
      }
      return [
        {
          file: 'zenity',
          args: [
            '--file-selection',
            `--title=${title}`,
            `--filename=${withTrailingSlash(start)}`,
            '--file-filter=Behavior tree (*.json) | *.json',
            '--file-filter=All files | *',
          ],
          interpret: interpretZenityLike,
        },
        {
          file: 'kdialog',
          args: ['--title', title, '--getopenfilename', start, '*.json|Behavior tree (*.json)'],
          interpret: interpretZenityLike,
        },
      ];
    }

    default:
      return [];
  }
}

/**
 * Creates a picker that opens the native file dialog of the machine running the server.
 * Only one dialog may be open at a time; a second call while one is open throws DialogBusyError.
 * Throws DialogUnsupportedError when no dialog program is available.
 */
export function createPicker(options: PickerOptions = {}): Picker {
  const platform = options.platform ?? process.platform;
  const run = options.run ?? runCommand;
  const timeoutMs = options.timeoutMs ?? DIALOG_TIMEOUT_MS;
  let open = false;

  return {
    async pick(kind, initialDir) {
      if (open) {
        throw new DialogBusyError();
      }
      open = true;
      try {
        for (const command of commandsFor(platform, kind, initialDir)) {
          let result: CommandResult;
          try {
            result = await run(command.file, command.args, { env: command.env, timeoutMs });
          } catch (err) {
            if (isErrno(err, 'ENOENT')) {
              continue; // Program not installed; try the next one.
            }
            throw err;
          }
          return command.interpret(result);
        }
        throw new DialogUnsupportedError(NO_DIALOG_MESSAGE);
      } finally {
        open = false;
      }
    },
  };
}
