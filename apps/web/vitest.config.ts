import { defineVitestConfig } from '@nuxt/test-utils/config';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

process.env.NODE_ENV ??= 'test';
process.env.VITEST ??= '1';

const vitestFilesRoot = resolve(import.meta.dirname, 'test-files', 'vitest');
const vitestTmpDir = resolve(vitestFilesRoot, 'tmp');
mkdirSync(vitestTmpDir, { recursive: true });
process.env.TMPDIR = vitestTmpDir;
process.env.TEMP = vitestTmpDir;
process.env.TMP = vitestTmpDir;

export default defineVitestConfig({
  // Vitest runs outside Nuxt's build pipeline, so the `import.meta.dev` define
  // Nuxt injects during its own build is absent and resolves to `false`. Nuxt
  // treats any non-production mode as dev, and tests run with MODE='test' — so
  // mirror that here. Without this, dev-only UI (e.g. the mobile-mode toggle on
  // the projects screen) and dev-only assertions are never exercised in tests.
  define: {
    'import.meta.dev': true,
  },
  resolve: {
    alias: {
      test: resolve(import.meta.dirname, 'test'),
      '~shared': resolve(import.meta.dirname, '../../packages/shared'),
      '~embed': resolve(import.meta.dirname, '../../packages/embed/src'),
    },
  },
  test: {
    environment: 'nuxt',
    globals: true,
    hookTimeout: 120_000,
    testTimeout: 60_000,
    // Limit concurrent workers to prevent OOM/swap pressure causing worker
    // startup timeouts ("Timeout waiting for worker to respond"). The machine
    // has constrained available RAM, so running all 8 forks simultaneously
    // causes heavy swapping and some workers miss their handshake window.
    pool: 'threads',
    fileParallelism: false,
    maxWorkers: 1,
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
      reportsDirectory: './test-files/vitest/coverage',
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
