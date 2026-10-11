import { mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { withFileLock, writeFileAtomic } from './fileLock';
import { sha256 } from './projectFile';

/*
 * Trust store for owl-bt.js plugins. A plugin runs code on the machine, so it only runs after the
 * user trusts the exact content of the file. The store keeps the sha256 of the trusted content per
 * plugin path. Any change to the file makes it untrusted again.
 */

/** Environment variable that overrides the trust file location (the desktop app sets it). */
export const TRUST_FILE_ENV = 'OWLBT_TRUST_FILE';

export interface TrustEntry {
  /** Normalised absolute path of the plugin (lower case on win32). */
  path: string;
  /** Hex sha256 of the trusted file content. */
  sha256: string;
}

export interface TrustStatus {
  trusted: boolean;
  /** True when the store has an entry for the path, but its hash differs from the current content. */
  changed: boolean;
}

/** The trust file: `OWLBT_TRUST_FILE` when set, otherwise ~/.owlbt/trusted-plugins.json. Read on every call. */
export function trustFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env[TRUST_FILE_ENV];
  return fromEnv ? resolve(fromEnv) : join(homedir(), '.owlbt', 'trusted-plugins.json');
}

/** Absolute, normalised plugin path used as the key of a trust entry. */
export function normalizePluginPath(pluginPath: string): string {
  const absolute = resolve(pluginPath);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

function isEntry(value: unknown): value is TrustEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.path === 'string' &&
    isAbsolute(record.path) &&
    typeof record.sha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(record.sha256)
  );
}

/** The entries of the trust file. A missing, unreadable or corrupt file gives no entries. */
export async function readTrustEntries(file: string = trustFilePath()): Promise<TrustEntry[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return [];
  }
  const plugins =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>).plugins
      : undefined;
  return Array.isArray(plugins) ? plugins.filter(isEntry) : [];
}

async function writeTrustEntries(entries: TrustEntry[], file: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFileAtomic(file, `${JSON.stringify({ plugins: entries }, null, 2)}\n`);
}

/** Trust status of the plugin with the given current content. */
export async function trustStatus(
  pluginPath: string,
  content: string,
  file: string = trustFilePath(),
): Promise<TrustStatus> {
  const key = normalizePluginPath(pluginPath);
  const entry = (await readTrustEntries(file)).find((item) => item.path === key);
  if (entry === undefined) {
    return { trusted: false, changed: false };
  }
  const trusted = entry.sha256 === sha256(content);
  return { trusted, changed: !trusted };
}

/** True when the current content of the plugin is the content the user trusted. */
export async function isTrusted(
  pluginPath: string,
  content: string,
  file: string = trustFilePath(),
): Promise<boolean> {
  return (await trustStatus(pluginPath, content, file)).trusted;
}

/** Trusts the plugin as it is on disk now. Replaces any earlier entry for the path. */
export async function trust(pluginPath: string, file: string = trustFilePath()): Promise<void> {
  const content = await readFile(pluginPath, 'utf8');
  const key = normalizePluginPath(pluginPath);
  await withFileLock(file, async () => {
    const entries = (await readTrustEntries(file)).filter((item) => item.path !== key);
    entries.push({ path: key, sha256: sha256(content) });
    await writeTrustEntries(entries, file);
  });
}

/** Removes the trust entry of the plugin. Does nothing when there is none. */
export async function revoke(pluginPath: string, file: string = trustFilePath()): Promise<void> {
  const key = normalizePluginPath(pluginPath);
  await withFileLock(file, async () => {
    const entries = await readTrustEntries(file);
    const kept = entries.filter((item) => item.path !== key);
    if (kept.length !== entries.length) {
      await writeTrustEntries(kept, file);
    }
  });
}
