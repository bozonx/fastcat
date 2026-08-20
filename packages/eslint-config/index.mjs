import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';

export const baseEslintConfig = [
  eslintPluginPrettierRecommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-function-type': 'error',
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/no-extraneous-class': 'error',
      '@typescript-eslint/no-dynamic-delete': 'error',
      '@typescript-eslint/no-useless-constructor': 'error',
      '@typescript-eslint/unified-signatures': 'error',
      'no-useless-escape': 'error',
      'no-empty': 'error',
      'no-unsafe-finally': 'error',
    },
  },
];

export default baseEslintConfig;
