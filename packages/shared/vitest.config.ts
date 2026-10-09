import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@owlbt/shared',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
