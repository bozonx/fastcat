import { test, expect } from 'vitest';

test('check isDev', () => {
  const isDev = typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV);
  console.log('import.meta.env:', import.meta.env);
  console.log('isDev:', isDev);
  expect(isDev).toBe(false);
});
