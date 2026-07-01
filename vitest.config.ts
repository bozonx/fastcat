import { defineVitestConfig } from '@nuxt/test-utils/config';

process.env.NODE_ENV ??= 'test';
process.env.VITEST ??= '1';

export default defineVitestConfig({
  test: {
    environment: 'nuxt',
    globals: true,
    hookTimeout: 120_000,
    testTimeout: 30_000,
    server: {
      deps: {
        inline: ['@nuxt/test-utils', '@nuxtjs/i18n'],
      },
    },
    include: [
      'test/unit/**/*.{test,spec}.ts',
      'test/components/**/*.{test,spec}.{ts,vue}',
      'test/integration/**/*.{test,spec}.ts',
      'test/golden-helpers/**/*.{test,spec}.ts',
    ],
    setupFiles: ['test/vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,vue}'],
      exclude: [
        '**/*.d.ts',
        '**/*.test.*',
        '**/*.spec.*',
        'test/**',
        'src/workers/**',
        'src/assets/**',
        '**/node_modules/**',
      ],
    },
  },
});
