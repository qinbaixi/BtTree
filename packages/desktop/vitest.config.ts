import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@owlbt/desktop',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
