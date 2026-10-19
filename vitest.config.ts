import { defineConfig } from 'vitest/config';

const roots = ['packages/*/src/**', 'apps/*/src/**'];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: roots.map((r) => `${r}/*.test.{ts,tsx}`),
          exclude: ['**/node_modules/**', '**/*.int.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: roots.map((r) => `${r}/*.int.test.ts`),
          globalSetup: ['packages/domain/src/testing/global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
