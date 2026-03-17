import { defineVitestConfig } from '@nuxt/test-utils/config';

process.env.NODE_ENV ??= 'test';
process.env.VITEST ??= '1';

export default defineVitestConfig({
  test: {
    environment: 'nuxt',
    globals: true,
    hookTimeout: 30_000,
    include: [
      'test/unit/**/*.{test,spec}.ts',
      'test/components/**/*.{test,spec}.{ts,vue}',
      'test/integration/**/*.{test,spec}.ts',
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
