import { baseEslintConfig } from '@fastcat/eslint-config';

export default [
  ...baseEslintConfig,
  {
    ignores: ['dist/**', 'editor/**', 'node_modules/**', '**/*.d.ts'],
  },
];
