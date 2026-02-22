import { defineVitestConfig } from '@nuxt/test-utils/config';

export default defineVitestConfig({
  test: {
    environment: 'nuxt',
    globals: true,
    include: ['test/unit/**/*.test.ts', 'test/unit/**/*.spec.ts'],
  },
});
