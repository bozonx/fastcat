import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';

export default [
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
    rules: {
      'no-console': 'off',
    },
  },
];
