import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  isTrusted,
  normalizePluginPath,
  readTrustEntries,
  revoke,
  trust,
  trustFilePath,
  trustStatus,
} from './pluginTrust';
import { sha256 } from './projectFile';

describe('trust file location', () => {
  it('uses OWLBT_TRUST_FILE when set and the home folder otherwise', () => {
    expect(trustFilePath({ OWLBT_TRUST_FILE: join(tmpdir(), 'custom.json') })).toBe(
      join(tmpdir(), 'custom.json'),
    );
    expect(trustFilePath({})).toMatch(/[\\/]\.owlbt[\\/]trusted-plugins\.json$/);
  });

  it('normalises plugin paths to absolute paths (lower case on win32)', () => {
    const key = normalizePluginPath(join('/work', 'owl-bt.js'));
    expect(key).toBe(process.platform === 'win32' ? key.toLowerCase() : join('/work', 'owl-bt.js'));
    expect(normalizePluginPath(join('/work', 'x', '..', 'owl-bt.js'))).toBe(key);
    expect(normalizePluginPath(join('/Work', 'owl-bt.js')) === key).toBe(
      process.platform === 'win32',
    );
  });
});

describe('trust store', () => {
  let root: string;
  let file: string;
  let plugin: string;
  const original = 'module.exports = { onTreeLoad() {} };';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'owlbt-trust-'));
    file = join(root, 'store', 'trusted-plugins.json');
    plugin = join(root, 'project', 'owl-bt.js');
    mkdirSync(join(root, 'project'), { recursive: true });
    writeFileSync(plugin, original);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reads an empty store when the file is missing or corrupt', async () => {
    expect(await readTrustEntries(file)).toEqual([]);
    mkdirSync(join(root, 'store'), { recursive: true });
    writeFileSync(file, '{ corrupt');
    expect(await readTrustEntries(file)).toEqual([]);
    expect(await isTrusted(plugin, original, file)).toBe(false);
  });

  it('ignores entries with an invalid shape', async () => {
    mkdirSync(join(root, 'store'), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({
        plugins: [{ path: 'relative.js', sha256: sha256(original) }, { path: plugin }],
      }),
    );
    expect(await readTrustEntries(file)).toEqual([]);
  });

  it('trusts the current content and reports it trusted', async () => {
    await trust(plugin, file);
    expect(await isTrusted(plugin, original, file)).toBe(true);
    expect(await trustStatus(plugin, original, file)).toEqual({ trusted: true, changed: false });
    const entries = await readTrustEntries(file);
    expect(entries).toEqual([{ path: normalizePluginPath(plugin), sha256: sha256(original) }]);
  });

  it('reports a changed plugin as untrusted and changed until it is trusted again', async () => {
    await trust(plugin, file);
    const edited = `${original}\n// edited`;
    expect(await trustStatus(plugin, edited, file)).toEqual({ trusted: false, changed: true });

    writeFileSync(plugin, edited);
    await trust(plugin, file);
    expect(await trustStatus(plugin, edited, file)).toEqual({ trusted: true, changed: false });
    expect(await readTrustEntries(file)).toHaveLength(1);
  });

  it('reports a plugin without an entry as untrusted and not changed', async () => {
    expect(await trustStatus(plugin, original, file)).toEqual({ trusted: false, changed: false });
  });

  it('revokes the entry of the plugin', async () => {
    await trust(plugin, file);
    await revoke(plugin, file);
    expect(await trustStatus(plugin, original, file)).toEqual({ trusted: false, changed: false });
    expect(await readTrustEntries(file)).toEqual([]);
  });

  it('does nothing when revoking a plugin that was never trusted', async () => {
    await revoke(plugin, file);
    expect(existsSync(file)).toBe(false);
  });

  it('keeps the entries of other plugins and leaves no temporary files behind', async () => {
    const other = join(root, 'other', 'owl-bt.js');
    mkdirSync(join(root, 'other'), { recursive: true });
    writeFileSync(other, 'module.exports = {};');
    await trust(plugin, file);
    await trust(other, file);
    await revoke(plugin, file);
    expect((await readTrustEntries(file)).map((entry) => entry.path)).toEqual([
      normalizePluginPath(other),
    ]);
    expect(readdirSync(join(root, 'store'))).toEqual(['trusted-plugins.json']);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toHaveProperty('plugins');
  });

  it('rejects trusting a plugin that does not exist', async () => {
    await expect(trust(join(root, 'missing', 'owl-bt.js'), file)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
