import type { IncomingMessage } from 'node:http';
import type { RequestHandler } from 'express';

/**
 * Host and Origin checks that protect the local API from DNS rebinding and from web pages on other
 * origins. The server has no authentication, so these checks are the only barrier for browsers.
 */

/** Host names that always pass: the loopback names the editor and the desktop app use. */
export const LOOPBACK_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '[::1]'];

/** Normalises a host name from options or headers: lower case, RFC-5952 IPv6 literals in brackets. */
export function normalizeHostname(host: string): string {
  const trimmed = host.trim();
  if (trimmed === '') {
    return '';
  }
  const candidate =
    trimmed.includes(':') && !trimmed.startsWith('[') ? `[${trimmed}]` : trimmed;
  try {
    const parsed = new URL(`http://${candidate}`);
    if (parsed.username === '' && parsed.password === '' && parsed.pathname === '/' && parsed.port === '') {
      return parsed.hostname.toLowerCase();
    }
  } catch {
    // Fall back to lower-cased text when not a valid URL host.
  }
  return candidate.toLowerCase();
}

const LOOPBACK_IPV4 = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** True for localhost, valid 127.0.0.0/8 and ::1. Anything else listens beyond this machine. */
export function isLoopbackHost(host: string): boolean {
  const name = normalizeHostname(host);
  if (LOOPBACK_HOSTS.includes(name)) {
    return true;
  }
  const match = LOOPBACK_IPV4.exec(name);
  if (!match) {
    return false;
  }
  return Number(match[1]) <= 255 && Number(match[2]) <= 255 && Number(match[3]) <= 255;
}

/** True for wildcard listen addresses (`0.0.0.0` or `::`). */
export function isWildcardHost(host: string): boolean {
  const name = normalizeHostname(host);
  return name === '0.0.0.0' || name === '[::]';
}

/**
 * The hostname of a Host header value (`localhost:9000`, `[::1]:9000`) or of an Origin header
 * (`http://localhost:5173`). Undefined when it cannot be parsed. The port is not returned.
 */
export function hostnameOf(value: string, kind: 'host' | 'origin'): string | undefined {
  try {
    const url = kind === 'origin' ? new URL(value) : new URL(`http://${value}`);
    if (kind === 'origin' && url.protocol !== 'http:' && url.protocol !== 'https:') {
      return undefined;
    }
    if (
      url.username !== '' ||
      url.password !== '' ||
      url.pathname !== '/' ||
      url.search !== '' ||
      url.hash !== ''
    ) {
      return undefined;
    }
    return url.hostname.toLowerCase() || undefined;
  } catch {
    return undefined;
  }
}

/** The set of hostnames a request may use: the loopback names plus the configured extra hosts. */
export function allowedHostnames(extra: readonly string[] = []): Set<string> {
  return new Set([...LOOPBACK_HOSTS, ...extra.map(normalizeHostname).filter((h) => h !== '')]);
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

/**
 * Express middleware for every route: Host must be allowed; any present Origin must be allowed;
 * cross-site Fetch Metadata requests to `/api` are also refused.
 */
export function localGuard(allowed: ReadonlySet<string>): RequestHandler {
  return (req, res, next) => {
    if (!isAllowedHost(req.headers.host, allowed)) {
      res.status(403).type('text/plain').send('Forbidden host');
      return;
    }
    if (!isAllowedOrigin(req.headers.origin, allowed)) {
      res.status(403).type('text/plain').send('Forbidden origin');
      return;
    }
    const isApi = req.path === '/api' || req.path.startsWith('/api/');
    if (isApi && req.headers['sec-fetch-site'] === 'cross-site') {
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
