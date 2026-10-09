import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getPort } from './config';

describe('getPort', () => {
  let dir: string;
  let rc: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'owlbt-config-'));
    rc = join(dir, '.owlbtrc');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('prefers the PORT env var over the rc file', () => {
    writeFileSync(rc, JSON.stringify({ port: 7000 }));
    expect(getPort({ PORT: '9123', NODE_ENV: 'development' }, rc)).toBe(9123);
  });

  it('uses the port from the rc file when PORT is not set', () => {
    writeFileSync(rc, JSON.stringify({ port: 7000 }));
    expect(getPort({ NODE_ENV: 'production' }, rc)).toBe(7000);
  });

  it('defaults to 9000 in development', () => {
    expect(getPort({ NODE_ENV: 'development' }, rc)).toBe(9000);
  });

  it('defaults to 8955 in production and when NODE_ENV is unset', () => {
    expect(getPort({ NODE_ENV: 'production' }, rc)).toBe(8955);
    expect(getPort({}, rc)).toBe(8955);
  });

  it('ignores a missing rc file', () => {
    expect(getPort({ NODE_ENV: 'production' }, join(dir, 'missing'))).toBe(8955);
  });

  it('ignores an invalid rc file', () => {
    writeFileSync(rc, '{ not json');
    expect(getPort({ NODE_ENV: 'development' }, rc)).toBe(9000);
  });

  it('ignores invalid ports in the rc file', () => {
    writeFileSync(rc, JSON.stringify({ port: 'abc' }));
    expect(getPort({}, rc)).toBe(8955);
    writeFileSync(rc, JSON.stringify({ port: 70000 }));
    expect(getPort({}, rc)).toBe(8955);
  });

  it('ignores an invalid PORT env var', () => {
    writeFileSync(rc, JSON.stringify({ port: 7000 }));
    expect(getPort({ PORT: 'not-a-number' }, rc)).toBe(7000);
  });
});
