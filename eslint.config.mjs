import withNuxt from './.nuxt/eslint.config.mjs';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';

export default withNuxt(eslintPluginPrettierRecommended).append({
  files: ['test/**/*.ts'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    'prettier/prettier': 'off',
  },
}).append({
  files: ['src/workers/**/*.ts'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unsafe-function-type': 'off',
    '@typescript-eslint/no-unused-vars': 'off',
    '@typescript-eslint/no-extraneous-class': 'off',
  },
}).append({
  files: ['src/utils/video-editor/**/*.ts', 'src/utils/webcodecs.ts'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unsafe-function-type': 'off',
    '@typescript-eslint/no-unused-vars': 'off',
  },
}).append({
  files: ['src/utils/**/*.ts'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unsafe-function-type': 'off',
    '@typescript-eslint/no-unused-vars': 'off',
    '@typescript-eslint/no-useless-constructor': 'off',
    'import/first': 'off',
    'no-useless-escape': 'off',
    'prettier/prettier': 'off',
  },
});
