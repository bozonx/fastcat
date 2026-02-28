import withNuxt from './.nuxt/eslint.config.mjs';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';

const nuxtConfig = withNuxt(eslintPluginPrettierRecommended);
const nuxtConfigArray = Array.isArray(nuxtConfig) ? nuxtConfig : [nuxtConfig];

export default [
  ...nuxtConfigArray,
  {
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'prettier/prettier': 'off',
    },
  },
];
