import { describe, expect, it } from 'vitest';
import {
  createPicker,
  DIALOG_TIMEOUT_MS,
  DialogBusyError,
  DialogUnsupportedError,
  type CommandOptions,
  type CommandResult,
  type RunCommand,
} from './picker';

interface Call {
  file: string;
  args: string[];
  options: CommandOptions;
}

function ok(stdout = '', exitCode = 0, stderr = ''): CommandResult {
  return { stdout, stderr, exitCode, timedOut: false };
}

function notInstalled(): Error {
  return Object.assign(new Error('spawn zenity ENOENT'), { code: 'ENOENT' });
}

/** Fake runner: records every call and answers with the given responder. */
function fakeRun(respond: (call: Call, index: number) => CommandResult | Promise<CommandResult>) {
  const calls: Call[] = [];
  const run: RunCommand = async (file, args, options) => {
    const call = { file, args, options };
    calls.push(call);
    return respond(call, calls.length - 1);
  };
  return { run, calls };
}

describe('createPicker on Windows', () => {
  it('opens a folder dialog through PowerShell and returns the selected path', async () => {
    const { run, calls } = fakeRun(() => ok('C:\\trees\r\n'));
    const picker = createPicker({ platform: 'win32', run });

    const result = await picker.pick('folder', 'C:\\start');

    expect(result).toEqual({ path: 'C:\\trees' });
    expect(calls[0].file).toBe('powershell.exe');
    expect(calls[0].args.slice(0, 3)).toEqual(['-NoProfile', '-STA', '-Command']);
    expect(calls[0].args[3]).toContain('[OwlbtFolderPicker]::Pick');
    expect(calls[0].options.env?.OWLBT_PICKER_CS).toContain('FOS_PICKFOLDERS');
    expect(calls[0].options.timeoutMs).toBe(DIALOG_TIMEOUT_MS);
  });

  it('passes the initial directory through the environment, never inside the script', async () => {
    const { run, calls } = fakeRun(() => ok(''));
    const picker = createPicker({ platform: 'win32', run });
    const dangerous = "C:\\x'; Remove-Item -Recurse C:\\";

    await picker.pick('folder', dangerous);

    expect(calls[0].options.env?.OWLBT_INITIAL_DIR).toBe(dangerous);
    expect(calls[0].args[3]).not.toContain(dangerous);
  });

  it('sends an empty initial directory when none is given', async () => {
    const { run, calls } = fakeRun(() => ok(''));
    await createPicker({ platform: 'win32', run }).pick('folder');
    expect(calls[0].options.env?.OWLBT_INITIAL_DIR).toBe('');
  });

  it('uses the file dialog with a JSON filter for kind file', async () => {
    const { run, calls } = fakeRun(() => ok('C:\\trees\\demo.json\n'));
    const result = await createPicker({ platform: 'win32', run }).pick('file');

    expect(result).toEqual({ path: 'C:\\trees\\demo.json' });
    expect(calls[0].args[3]).toContain('OpenFileDialog');
    expect(calls[0].args[3]).toContain('Behavior tree (*.json)|*.json');
  });

  it('reports cancelling as cancelled when nothing is printed', async () => {
    const { run } = fakeRun(() => ok(''));
    expect(await createPicker({ platform: 'win32', run }).pick('folder')).toEqual({
      cancelled: true,
    });
  });

  it('rejects when PowerShell exits with an error', async () => {
    const { run } = fakeRun(() => ok('', 1, 'Add-Type failed'));
    await expect(createPicker({ platform: 'win32', run }).pick('folder')).rejects.toThrow(
      /exit code 1: Add-Type failed/,
    );
  });
});

describe('createPicker on macOS', () => {
  it('chooses a folder with osascript and strips the trailing slash', async () => {
    const { run, calls } = fakeRun(() => ok('/Users/me/trees/\n'));
    const result = await createPicker({ platform: 'darwin', run }).pick('folder');

    expect(result).toEqual({ path: '/Users/me/trees' });
    expect(calls[0].file).toBe('osascript');
    expect(calls[0].args[0]).toBe('-e');
    expect(calls[0].args[1]).toContain('POSIX path of (choose folder');
  });

  it('chooses a JSON file', async () => {
    const { run, calls } = fakeRun(() => ok('/Users/me/trees/demo.json\n'));
    const result = await createPicker({ platform: 'darwin', run }).pick('file');

    expect(result).toEqual({ path: '/Users/me/trees/demo.json' });
    expect(calls[0].args[1]).toContain('choose file');
    expect(calls[0].args[1]).toContain('of type {"json"}');
  });

  it('escapes the initial directory for AppleScript', async () => {
    const { run, calls } = fakeRun(() => ok(''));
    await createPicker({ platform: 'darwin', run }).pick('folder', '/tmp/a"b\\c');

    expect(calls[0].args[1]).toContain('default location POSIX file "/tmp/a\\"b\\\\c"');
  });

  it('treats error -128 "User canceled" as cancelled', async () => {
    const { run } = fakeRun(() => ok('', 1, 'execution error: User canceled. (-128)'));
    expect(await createPicker({ platform: 'darwin', run }).pick('folder')).toEqual({
      cancelled: true,
    });
  });

  it('rejects other osascript failures', async () => {
    const { run } = fakeRun(() => ok('', 1, 'something broke'));
    await expect(createPicker({ platform: 'darwin', run }).pick('file')).rejects.toThrow(
      /something broke/,
    );
  });
});

describe('createPicker on Linux', () => {
  it('uses zenity for a folder, starting in the given directory', async () => {
    const { run, calls } = fakeRun(() => ok('/home/me/trees\n'));
    const result = await createPicker({ platform: 'linux', run }).pick('folder', '/start');

    expect(result).toEqual({ path: '/home/me/trees' });
    expect(calls[0].file).toBe('zenity');
    expect(calls[0].args).toContain('--directory');
    expect(calls[0].args).toContain('--filename=/start/');
  });

  it('uses zenity with a JSON filter for a file', async () => {
    const { run, calls } = fakeRun(() => ok('/home/me/trees/a.json\n'));
    const result = await createPicker({ platform: 'linux', run }).pick('file');

    expect(result).toEqual({ path: '/home/me/trees/a.json' });
    expect(calls[0].args).toContain('--file-filter=Behavior tree (*.json) | *.json');
  });

  it('falls back to kdialog when zenity is not installed', async () => {
    const { run, calls } = fakeRun((call) => {
      if (call.file === 'zenity') {
        throw notInstalled();
      }
      return ok('/home/me/trees\n');
    });
    const result = await createPicker({ platform: 'linux', run }).pick('folder');

    expect(result).toEqual({ path: '/home/me/trees' });
    expect(calls.map((c) => c.file)).toEqual(['zenity', 'kdialog']);
    expect(calls[1].args).toContain('--getexistingdirectory');
  });

  it('uses kdialog --getopenfilename for a file when zenity is missing', async () => {
    const { run, calls } = fakeRun((call) => {
      if (call.file === 'zenity') {
        throw notInstalled();
      }
      return ok('/home/me/a.json\n');
    });
    await createPicker({ platform: 'linux', run }).pick('file');
    expect(calls[1].args).toContain('--getopenfilename');
  });

  it('is unsupported when neither zenity nor kdialog is installed', async () => {
    const { run } = fakeRun(() => {
      throw notInstalled();
    });
    const picker = createPicker({ platform: 'linux', run });

    await expect(picker.pick('folder')).rejects.toBeInstanceOf(DialogUnsupportedError);
  });

  it('treats exit code 1 without output as cancelled', async () => {
    const { run } = fakeRun(() => ok('', 1));
    expect(await createPicker({ platform: 'linux', run }).pick('file')).toEqual({
      cancelled: true,
    });
  });
});

describe('createPicker general behaviour', () => {
  it('is unsupported on other platforms without running anything', async () => {
    const { run, calls } = fakeRun(() => ok(''));
    const picker = createPicker({ platform: 'freebsd', run });

    await expect(picker.pick('folder')).rejects.toBeInstanceOf(DialogUnsupportedError);
    expect(calls).toHaveLength(0);
  });

  it('treats a timed out dialog as cancelled', async () => {
    const { run } = fakeRun(() => ({ stdout: '', stderr: '', exitCode: -1, timedOut: true }));
    expect(await createPicker({ platform: 'win32', run }).pick('folder')).toEqual({
      cancelled: true,
    });
  });

  it('uses the configured timeout', async () => {
    const { run, calls } = fakeRun(() => ok(''));
    await createPicker({ platform: 'win32', run, timeoutMs: 1234 }).pick('folder');
    expect(calls[0].options.timeoutMs).toBe(1234);
  });

  it('allows only one dialog at a time and frees the slot afterwards', async () => {
    let release: (value: CommandResult) => void = () => {};
    const { run } = fakeRun(() => new Promise<CommandResult>((resolve) => (release = resolve)));
    const picker = createPicker({ platform: 'win32', run });

    const first = picker.pick('folder');
    await expect(picker.pick('file')).rejects.toBeInstanceOf(DialogBusyError);

    release(ok(''));
    expect(await first).toEqual({ cancelled: true });

    const third = picker.pick('folder');
    release(ok('C:\\x\n'));
    expect(await third).toEqual({ path: 'C:\\x' });
  });

  it('frees the slot when the dialog fails', async () => {
    const { run } = fakeRun(() => ok('', 2, 'broken'));
    const picker = createPicker({ platform: 'win32', run });

    await expect(picker.pick('folder')).rejects.toThrow();
    await expect(picker.pick('folder')).rejects.not.toBeInstanceOf(DialogBusyError);
  });
});
