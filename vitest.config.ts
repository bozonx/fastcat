import { defineVitestConfig } from '@nuxt/test-utils/config';

process.env.NODE_ENV ??= 'test';
process.env.VITEST ??= '1';

export default defineVitestConfig({
  test: {
    environment: 'nuxt',
    globals: true,
    include: ['test/unit/**/*.test.ts', 'test/unit/**/*.spec.ts'],
    setupFiles: ['test/vitest.setup.ts'],
  },
});
