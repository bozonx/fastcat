import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import tseslint from 'typescript-eslint';

export const baseEslintConfig = tseslint.config(
  eslintPluginPrettierRecommended,
  {
    files: ['**/*.ts', '**/*.mts', '**/*.cts', '**/*.tsx'],
    extends: [...tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-function-type': 'error',
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/no-extraneous-class': 'error',
      '@typescript-eslint/no-dynamic-delete': 'error',
      '@typescript-eslint/no-useless-constructor': 'error',
      '@typescript-eslint/unified-signatures': 'error',
    },
  },
  {
    files: [
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
      '**/*.ts',
      '**/*.mts',
      '**/*.cts',
      '**/*.tsx',
      '**/*.vue',
    ],
    rules: {
      'no-useless-escape': 'error',
      'no-empty': 'error',
      'no-unsafe-finally': 'error',
    },
  },
);

export default baseEslintConfig;
