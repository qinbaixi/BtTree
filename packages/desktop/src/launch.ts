/** Pure helpers for the desktop main process: ports, launch arguments, window state. */
import { resolve } from 'node:path';

export interface WindowState {
  /** Screen position of the normal (not maximized) window. Omitted when unknown. */
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DEFAULT_WINDOW_STATE: Readonly<WindowState> = {
  width: 1400,
  height: 900,
  maximized: false,
};

const MIN_SIZE = 400;
const MAX_SIZE = 10000;

/** The ports to try, in order: `start` and the `count - 1` ports after it. */
export function candidatePorts(start: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => start + i);
}

/**
 * The first argument that names an existing .json file, as an absolute path.
 * Relative paths are resolved against `cwd` (the second-instance cwd, or the process cwd).
 */
export function treePathFromArgs(
  args: readonly string[],
  cwd: string,
  isFile: (path: string) => boolean,
): string | undefined {
  for (const arg of args) {
    if (arg.startsWith('-') || !/\.json$/i.test(arg)) {
      continue;
    }
    const full = resolve(cwd, arg);
    if (isFile(full)) {
      return full;
    }
  }
  return undefined;
}

/** The app route for an optional tree file: the home page, or the tree editor. */
export function routeFor(treePath: string | undefined): string {
  return treePath === undefined ? '/' : `/tree?path=${encodeURIComponent(treePath)}`;
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : undefined;
}

function size(value: unknown, fallback: number): number {
  const n = finite(value);
  return n !== undefined && n >= MIN_SIZE && n <= MAX_SIZE ? n : fallback;
}

/** Validates the stored JSON. Anything unusable falls back to the defaults. */
export function parseWindowState(raw: unknown): WindowState {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const x = finite(record.x);
  const y = finite(record.y);
  return {
    width: size(record.width, DEFAULT_WINDOW_STATE.width),
    height: size(record.height, DEFAULT_WINDOW_STATE.height),
    maximized: record.maximized === true,
    ...(x !== undefined && y !== undefined ? { x, y } : {}),
  };
}

/**
 * The stored position when it is still on a screen (checked at the title bar), otherwise undefined
 * so the window is centred by the system. Monitors can be unplugged between launches.
 */
export function placementOn(
  state: WindowState,
  workAreas: readonly Area[],
): { x: number; y: number } | undefined {
  if (state.x === undefined || state.y === undefined) {
    return undefined;
  }
  const px = state.x + 50;
  const py = state.y + 15;
  const visible = workAreas.some(
    (area) => px >= area.x && px < area.x + area.width && py >= area.y && py < area.y + area.height,
  );
  return visible ? { x: state.x, y: state.y } : undefined;
}

/**
 * Route asked for by a second launch while this instance is still starting. A launch without a file
 * (route '/') keeps the earlier request. The latest request wins.
 */
export function nextPendingRoute(
  pending: string | undefined,
  requested: string,
): string | undefined {
  return requested === '/' ? pending : requested;
}

/** Route of the first window: the request queued while starting, otherwise the route of this launch. */
export function startupRoute(pending: string | undefined, initial: string): string {
  return pending ?? initial;
}
