import { defineConfig } from 'tsup';

export default defineConfig({
  noExternal: ['@owlbt/shared'],
  // Each entry is self-contained so that index.js's direct-run check only fires for index.js.
  splitting: false,
});
