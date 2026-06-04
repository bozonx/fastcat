import withNuxt from './.nuxt/eslint.config.mjs';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';

export default withNuxt(eslintPluginPrettierRecommended)
  .append({
    ignores: [
      '.output/**',
      '.nuxt/**',
      'dist/**',
      'coverage/**',
      'node_modules/**',
      'src-tauri/**',
      'scripts/patch_transform.js',
      '**/*.d.ts',
      // ts-rs generated bindings (Rust is the source of truth; do not lint/format).
      'src/types/generated/**',
    ],
  })
  .append({
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-function-type': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-extraneous-class': 'warn',
      '@typescript-eslint/no-dynamic-delete': 'warn',
      '@typescript-eslint/no-useless-constructor': 'warn',
      '@typescript-eslint/unified-signatures': 'warn',
      'no-useless-escape': 'warn',
      'vue/multi-word-component-names': 'warn',
      'vue/require-default-prop': 'warn',
      'no-empty': 'warn',
      'no-unsafe-finally': 'warn',
      // Diagnostic logging must go through ~/utils/dev-logger (gated by env and
      // mockable in tests).
      'no-console': 'error',
    },
  })
  .append({
    files: ['test/**/*.ts', 'test/**/*.vue'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/no-dynamic-delete': 'off',
      '@typescript-eslint/no-useless-constructor': 'off',
      '@typescript-eslint/unified-signatures': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-useless-escape': 'off',
      'vue/multi-word-component-names': 'off',
      'vue/require-default-prop': 'off',
      'no-empty': 'off',
      'no-unsafe-finally': 'off',
      'no-console': 'off',
    },
  })
  .append({
    files: ['src/**/*.vue'],
    rules: {
      '@typescript-eslint/unified-signatures': 'off',
    },
  })
  .append({
    files: ['src/pages/**/*.vue', 'src/layouts/**/*.vue'],
    rules: {
      'vue/multi-word-component-names': 'off',
    },
  })
  .append({
    // Build/dev CLI scripts are Node tools whose console output is the point.
    files: ['scripts/**'],
    rules: {
      'no-console': 'off',
    },
  });
