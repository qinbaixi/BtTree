/* global console, process */
// Copies the client build into the server bundle so the published package serves the UI itself.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(serverDir, '../client/dist');
const dest = join(serverDir, 'dist', 'public');

if (!existsSync(join(src, 'index.html'))) {
  console.error(
    `copy-client: client build not found at ${src}. Run "npm run build -w @owlbt/client" first.`,
  );
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log(`copy-client: ${src} -> ${dest}`);

// The built-in samples are served from dist/samples (see src/samples.ts).
const samplesSrc = resolve(serverDir, '../../samples');
const samplesDest = join(serverDir, 'dist', 'samples');
rmSync(samplesDest, { recursive: true, force: true });
if (existsSync(samplesSrc)) {
  cpSync(samplesSrc, samplesDest, { recursive: true });
  console.log(`copy-client: ${samplesSrc} -> ${samplesDest}`);
}
