/* global console */
// Bundles the Electron main process and the window preload into CommonJS files. Everything is inlined
// except Electron itself and socket.io's optional native accelerators, so the packaged app needs no
// node_modules.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serverEntry = resolve(desktopDir, '../server/src/index.ts');
const outFile = resolve(desktopDir, 'dist/main.cjs');
const preloadFile = resolve(desktopDir, 'dist/preload.cjs');

mkdirSync(dirname(outFile), { recursive: true });

const result = await build({
  entryPoints: [resolve(desktopDir, 'src/main.ts')],
  outfile: outFile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'warning',
  metafile: true,
  external: ['electron', 'bufferutil', 'utf-8-validate'],
  // The server source is bundled directly: the workspace package has no main entry of its own.
  plugins: [
    {
      name: 'owlbt-server-source',
      setup(buildApi) {
        buildApi.onResolve({ filter: /^@owlbt\/server$/ }, () => ({ path: serverEntry }));
      },
    },
  ],
  // import.meta.url is empty in CommonJS. The server uses it only to locate its own files, and the
  // desktop app passes every path explicitly, so a file URL of the bundle is enough.
  define: { 'import.meta.url': '__owlbtImportMetaUrl' },
  banner: {
    js: "var __owlbtImportMetaUrl = require('node:url').pathToFileURL(__filename).href;",
  },
});

// The preload runs sandboxed, where require() only knows 'electron', so it is one self-contained file.
await build({
  entryPoints: [resolve(desktopDir, 'src/preload.ts')],
  outfile: preloadFile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'warning',
  external: ['electron'],
});

const inlined = new Set();
for (const file of Object.keys(result.metafile.inputs)) {
  const marker = file.lastIndexOf('node_modules/');
  if (marker !== -1) {
    const parts = file.slice(marker + 'node_modules/'.length).split('/');
    inlined.add(parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]);
  }
}
console.log(`bundled ${outFile} (${inlined.size} npm packages inlined) and ${preloadFile}`);
