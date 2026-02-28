import withNuxt from './.nuxt/eslint.config.mjs';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';

export default withNuxt(eslintPluginPrettierRecommended).append({
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
  },
});
