import { baseEslintConfig } from '@fastcat/eslint-config';

export default [
  ...baseEslintConfig,
  {
    ignores: ['dist/**', 'node_modules/**', '**/*.d.ts'],
  },
];
