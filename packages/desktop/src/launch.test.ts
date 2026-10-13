import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canInstallUpdates,
  candidatePorts,
  DEFAULT_WINDOW_STATE,
  nextPendingRoute,
  parseWindowState,
  placementOn,
  routeFor,
  startupRoute,
  treePathFromArgs,
} from './launch';

describe('candidatePorts', () => {
  it('lists consecutive ports from the start', () => {
    expect(candidatePorts(18955, 3)).toEqual([18955, 18956, 18957]);
  });
});

describe('treePathFromArgs', () => {
  const cwd = resolve('/work');
  const files = new Set([resolve('/work/a/tree.json'), resolve('/abs/other.JSON')]);
  const isFile = (path: string): boolean => files.has(path);

  it('returns the first existing .json argument, resolved against cwd', () => {
    expect(treePathFromArgs(['.', 'a/tree.json'], cwd, isFile)).toBe(resolve('/work/a/tree.json'));
  });

  it('accepts absolute paths and ignores the case of the extension', () => {
    expect(treePathFromArgs([resolve('/abs/other.JSON')], cwd, isFile)).toBe(
      resolve('/abs/other.JSON'),
    );
  });

  it('skips flags, non-json arguments and missing files', () => {
    expect(
      treePathFromArgs(['--inspect', 'readme.txt', 'missing.json'], cwd, isFile),
    ).toBeUndefined();
    expect(treePathFromArgs([], cwd, isFile)).toBeUndefined();
  });
});

describe('routeFor', () => {
  it('opens the home page without a tree', () => {
    expect(routeFor(undefined)).toBe('/');
  });

  it('encodes the tree path in the query', () => {
    expect(routeFor('D:\\x y\\tree.json')).toBe('/tree?path=D%3A%5Cx%20y%5Ctree.json');
  });
});

describe('parseWindowState', () => {
  it('falls back to the defaults for missing or invalid data', () => {
    expect(parseWindowState(undefined)).toEqual(DEFAULT_WINDOW_STATE);
    expect(parseWindowState('nope')).toEqual(DEFAULT_WINDOW_STATE);
    expect(parseWindowState({ width: 10, height: 'x', x: 5 })).toEqual(DEFAULT_WINDOW_STATE);
  });

  it('keeps a valid stored state, including the position when both coordinates are present', () => {
    expect(
      parseWindowState({ x: 100.4, y: 50, width: 1200, height: 800, maximized: true }),
    ).toEqual({ x: 100, y: 50, width: 1200, height: 800, maximized: true });
    expect(parseWindowState({ x: 100, width: 1200, height: 800 })).toEqual({
      width: 1200,
      height: 800,
      maximized: false,
    });
  });
});

describe('placementOn', () => {
  const screen = [{ x: 0, y: 0, width: 1920, height: 1040 }];

  it('keeps a position whose title bar is on a screen', () => {
    const state = { x: 100, y: 100, width: 1400, height: 900, maximized: false };
    expect(placementOn(state, screen)).toEqual({ x: 100, y: 100 });
  });

  it('drops a position that is off every screen', () => {
    const state = { x: 5000, y: 100, width: 1400, height: 900, maximized: false };
    expect(placementOn(state, screen)).toBeUndefined();
    expect(placementOn(DEFAULT_WINDOW_STATE, screen)).toBeUndefined();
  });
});

describe('nextPendingRoute and startupRoute', () => {
  it('queues a requested file route and lets the latest request win', () => {
    expect(nextPendingRoute(undefined, '/tree?path=a')).toBe('/tree?path=a');
    expect(nextPendingRoute('/tree?path=a', '/tree?path=b')).toBe('/tree?path=b');
  });

  it('keeps an earlier request when the second launch names no file', () => {
    expect(nextPendingRoute('/tree?path=a', '/')).toBe('/tree?path=a');
    expect(nextPendingRoute(undefined, '/')).toBeUndefined();
  });

  it('opens the queued route first, otherwise the route of this launch', () => {
    expect(startupRoute('/tree?path=queued', '/tree?path=argv')).toBe('/tree?path=queued');
    expect(startupRoute(undefined, '/tree?path=argv')).toBe('/tree?path=argv');
    expect(startupRoute(undefined, '/')).toBe('/');
  });
});

describe('canInstallUpdates', () => {
  it('updates the installed Windows app and a Linux AppImage', () => {
    expect(canInstallUpdates(true, 'win32', {})).toBe(true);
    expect(canInstallUpdates(true, 'linux', { APPIMAGE: '/opt/owl-bt.AppImage' })).toBe(true);
  });

  it('does not update the portable exe, other Linux builds, macOS or development', () => {
    expect(canInstallUpdates(true, 'win32', { PORTABLE_EXECUTABLE_FILE: 'C:\\owl-bt.exe' })).toBe(
      false,
    );
    expect(canInstallUpdates(true, 'linux', {})).toBe(false);
    expect(canInstallUpdates(true, 'darwin', {})).toBe(false);
    expect(canInstallUpdates(false, 'win32', {})).toBe(false);
  });
});
