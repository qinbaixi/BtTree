import type { IncomingMessage } from 'node:http';
import type { RequestHandler } from 'express';

/**
 * Host and Origin checks that protect the local API from DNS rebinding and from web pages on other
 * origins. The server has no authentication, so these checks are the only barrier for browsers.
 */

/** Host names that always pass: the loopback names the editor and the desktop app use. */
export const LOOPBACK_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '[::1]'];

/** Normalises a host name from options or headers: lower case, IPv6 literals in brackets. */
export function normalizeHostname(host: string): string {
  const lower = host.trim().toLowerCase();
  if (lower.includes(':') && !lower.startsWith('[')) {
    return `[${lower}]`;
  }
  return lower;
}

/** True for localhost, 127.x.x.x and ::1. Anything else listens beyond this machine. */
export function isLoopbackHost(host: string): boolean {
  const name = normalizeHostname(host);
  return LOOPBACK_HOSTS.includes(name) || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(name);
}

/**
 * The hostname of a Host header value (`localhost:9000`, `[::1]:9000`) or of an Origin header
 * (`http://localhost:5173`). Undefined when it cannot be parsed. The port is not returned.
 */
export function hostnameOf(value: string, kind: 'host' | 'origin'): string | undefined {
  try {
    const url = kind === 'origin' ? new URL(value) : new URL(`http://${value}`);
    if (kind === 'host' && (url.username !== '' || url.password !== '' || url.pathname !== '/')) {
      return undefined;
    }
    return url.hostname.toLowerCase() || undefined;
  } catch {
    return undefined;
  }
}

/** The set of hostnames a request may use: the loopback names plus the configured extra hosts. */
export function allowedHostnames(extra: readonly string[] = []): Set<string> {
  return new Set([...LOOPBACK_HOSTS, ...extra.map(normalizeHostname)]);
}

/** True when the Host header names an allowed host. A missing or malformed header is refused. */
export function isAllowedHost(
  hostHeader: string | undefined,
  allowed: ReadonlySet<string>,
): boolean {
  if (hostHeader === undefined) {
    return false;
  }
  const name = hostnameOf(hostHeader, 'host');
  return name !== undefined && allowed.has(name);
}

/** True when the Origin header (if any) names an allowed host. Requests without Origin pass. */
export function isAllowedOrigin(origin: string | undefined, allowed: ReadonlySet<string>): boolean {
  if (origin === undefined) {
    return true;
  }
  const name = hostnameOf(origin, 'origin');
  return name !== undefined && allowed.has(name);
}

/** Express middleware for every route: Host must be allowed; unsafe methods also need an allowed Origin. */
export function localGuard(allowed: ReadonlySet<string>): RequestHandler {
  return (req, res, next) => {
    if (!isAllowedHost(req.headers.host, allowed)) {
      res.status(403).type('text/plain').send('Forbidden host');
      return;
    }
    const safe = req.method === 'GET' || req.method === 'HEAD';
    if (!safe && !isAllowedOrigin(req.headers.origin, allowed)) {
      res.status(403).type('text/plain').send('Forbidden origin');
      return;
    }
    next();
  };
}

/** socket.io `allowRequest` check. Host must be allowed, and an Origin header must be allowed when sent. */
export function socketRequestAllowed(req: IncomingMessage, allowed: ReadonlySet<string>): boolean {
  return isAllowedHost(req.headers.host, allowed) && isAllowedOrigin(req.headers.origin, allowed);
}
