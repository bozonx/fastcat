import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslintPluginPrettierRecommended,
  {
    ignores: [
      'apps/**',
      'packages/**',
      'node_modules/**',
      'test-files/**',
      'dist/**',
      '.output/**',
      'scripts/patch_transform.js',
    ],
  },
  {
    files: ['scripts/**/*.mjs', 'scripts/**/*.js', 'scripts/**/*.ts'],
    extends: [...tseslint.configs.recommended],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
