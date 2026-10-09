import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION } from '@owlbt/shared';
import { run } from './run';

export { run, type RunOptions, type RunResult } from './run';

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url);
}

// Direct run (`tsx watch src/index.ts` in dev, or `node dist/index.js`).
// NODE_ENV defaults to development here. In development the port is fixed to 9000 (the Vite proxy target),
// overridable by OWLBT_DEV_PORT, so a generic PORT meant for the dev tooling is not picked up.
if (isEntryPoint()) {
  process.env.NODE_ENV ??= 'development';
  const devPort =
    process.env.NODE_ENV === 'development' ? Number(process.env.OWLBT_DEV_PORT ?? 9000) : undefined;
  run({
    port: devPort,
    onListening: ({ port, reused }) => {
      console.log(
        reused
          ? `owl-bt server already running on port ${port}`
          : `owl-bt server ${VERSION} listening on http://localhost:${port} (${process.env.NODE_ENV})`,
      );
    },
  }).catch((err: unknown) => {
    console.error(`owl-bt: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
