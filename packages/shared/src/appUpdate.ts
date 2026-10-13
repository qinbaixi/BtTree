/**
 * Update check of the desktop app: the state the Electron main process reports to the page, and the
 * version comparison it uses. The page reads it through `window.owlbtDesktop` (see the desktop preload).
 */

/** GitHub repository whose releases carry the desktop builds. */
export const RELEASE_REPO = 'qinbaixi/BtTree';
/** Page with every release, opened when the app cannot install an update itself. */
export const RELEASES_URL = `https://github.com/${RELEASE_REPO}/releases`;

export type AppUpdateStatus =
  /** Nothing checked yet. */
  | 'idle'
  | 'checking'
  /** The running version is the newest release. */
  | 'latest'
  /** A newer release exists and has not been downloaded. */
  | 'available'
  | 'downloading'
  /** The update is downloaded and is installed when the app restarts. */
  | 'downloaded'
  | 'error';

export interface AppUpdateState {
  status: AppUpdateStatus;
  /** Version of the running app, e.g. "0.2.0". */
  currentVersion: string;
  /** Version of the newest release, once a check found one. */
  latestVersion?: string;
  /** Page of the newest release (or of all releases), for builds that cannot update themselves. */
  releaseUrl?: string;
  /** Whether this build downloads and installs updates itself (the Windows installer build). */
  canInstall: boolean;
  /** Download progress, 0 to 100, while downloading. */
  percent?: number;
  /** What went wrong, when status is 'error'. */
  error?: string;
}

/** The API the desktop preload exposes to the page as `window.owlbtDesktop`. */
export interface DesktopBridge {
  getUpdateState(): Promise<AppUpdateState>;
  /** Checks GitHub for a newer release. */
  checkForUpdate(): Promise<AppUpdateState>;
  /** Downloads the newer release, or opens its page when this build cannot install it. */
  downloadUpdate(): Promise<AppUpdateState>;
  /** Restarts the app and installs the downloaded update. */
  installUpdate(): Promise<void>;
  /** Calls `listener` on every state change. Returns a function that stops listening. */
  onUpdateState(listener: (state: AppUpdateState) => void): () => void;
}

function parseVersion(version: string): { core: number[]; pre: string | undefined } | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    version.trim(),
  );
  if (!match) {
    return undefined;
  }
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] };
}

function comparePrerelease(a: string, b: string): number {
  const left = a.split('.');
  const right = b.split('.');
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const x = left[i];
    const y = right[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      const diff = Number(x) - Number(y);
      if (diff !== 0) return Math.sign(diff);
    } else if (xNum !== yNum) {
      return xNum ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Compares two semantic versions ("1.2.3", "v1.2.3-beta.1"): negative when `a` is older, positive
 * when newer, 0 when equal. Returns undefined when either is not a version.
 */
export function compareVersions(a: string, b: string): number | undefined {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) {
    return undefined;
  }
  for (let i = 0; i < 3; i++) {
    const diff = left.core[i] - right.core[i];
    if (diff !== 0) return Math.sign(diff);
  }
  if (left.pre === undefined || right.pre === undefined) {
    // A release is newer than its prereleases.
    return left.pre === right.pre ? 0 : left.pre === undefined ? 1 : -1;
  }
  return comparePrerelease(left.pre, right.pre);
}

/** Whether `candidate` is a newer version than `current`. False when either is not a version. */
export function isNewerVersion(candidate: string, current: string): boolean {
  return (compareVersions(candidate, current) ?? 0) > 0;
}

/** The newest release from a GitHub `releases/latest` response, or undefined when it has none. */
export function parseLatestRelease(raw: unknown): { version: string; url: string } | undefined {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const tag = typeof record.tag_name === 'string' ? record.tag_name.trim() : '';
  if (!parseVersion(tag)) {
    return undefined;
  }
  const url =
    typeof record.html_url === 'string' && record.html_url.startsWith('https://')
      ? record.html_url
      : RELEASES_URL;
  return { version: tag.replace(/^v/, ''), url };
}
