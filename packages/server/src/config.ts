import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const PRODUCTION_PORT = 8955;
export const DEVELOPMENT_PORT = 9000;

export function defaultRcPath(): string {
  return join(homedir(), '.owlbtrc');
}

function parsePort(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value.trim()) : value;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 && n < 65536 ? n : undefined;
}

/** Reads `port` from the JSON rc file. Missing or invalid files are ignored. */
function readRcPort(rcPath: string): number | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(rcPath, 'utf8'));
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsePort((parsed as Record<string, unknown>).port);
    }
  } catch {
    // missing or invalid rc file
  }
  return undefined;
}

/**
 * Resolves the server port: `PORT` env var, then `port` in ~/.owlbtrc,
 * then 9000 when NODE_ENV is 'development' and 8955 otherwise.
 */
export function getPort(
  env: NodeJS.ProcessEnv = process.env,
  rcPath: string = defaultRcPath(),
): number {
  const fromEnv = parsePort(env.PORT);
  if (fromEnv !== undefined) {
    return fromEnv;
  }
  const fromRc = readRcPort(rcPath);
  if (fromRc !== undefined) {
    return fromRc;
  }
  return env.NODE_ENV === 'development' ? DEVELOPMENT_PORT : PRODUCTION_PORT;
}
