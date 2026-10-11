import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION } from '@owlbt/shared';
import { run } from './run';

export { run, type RunOptions, type RunResult } from './run';
export {
  DialogBusyError,
  DialogUnsupportedError,
  type Picker,
  type PickKind,
  type PickResult,
} from './picker';

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url);
}

export interface DevOptions {
  /** Interface from `--host <host>` or `--host=<host>`, else OWLBT_HOST. Undefined keeps the default. */
  host?: string;
  trustAllPlugins: boolean;
}

/** Reads `--host` (argument wins over OWLBT_HOST) and `--trust-plugins` / OWLBT_TRUST_PLUGINS=1. */
export function parseDevOptions(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): DevOptions {
  let host: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--host') {
      host = argv[i + 1];
      i++;
    } else if (arg.startsWith('--host=')) {
      host = arg.slice('--host='.length);
    }
  }
  const fromEnv = env.OWLBT_HOST?.trim();
  return {
    host: host?.trim() || (fromEnv ? fromEnv : undefined),
    trustAllPlugins: argv.includes('--trust-plugins') || env.OWLBT_TRUST_PLUGINS === '1',
  };
}

// Direct run (`tsx watch src/index.ts` in dev, or `node dist/index.js`).
// NODE_ENV defaults to development here. In development the port is fixed to 9000 (the Vite proxy target),
// overridable by OWLBT_DEV_PORT, so a generic PORT meant for the dev tooling is not picked up.
// The server listens on 127.0.0.1 unless --host or OWLBT_HOST names another interface.
if (isEntryPoint()) {
  process.env.NODE_ENV ??= 'development';
  const devPort =
    process.env.NODE_ENV === 'development' ? Number(process.env.OWLBT_DEV_PORT ?? 9000) : undefined;
  const dev = parseDevOptions(process.argv.slice(2));
  run({
    port: devPort,
    host: dev.host,
    trustAllPlugins: dev.trustAllPlugins,
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
