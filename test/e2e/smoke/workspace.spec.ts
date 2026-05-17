import { test, expect } from '@playwright/test';
import { setupVirtualWorkspace, clearOpfs } from '../../utils/e2e/virtual-fs';

test.describe('Smoke: Workspace Initialization', () => {
  test('OPFS is supported in the test browser', async ({ page }) => {
    await page.goto('/');
    const isOpfsSupported = await page.evaluate(() => {
      return (
        typeof navigator !== 'undefined' &&
        typeof navigator.storage !== 'undefined' &&
        typeof navigator.storage.getDirectory === 'function'
      );
    });

    expect(isOpfsSupported).toBe(true);
  });

  test('virtual workspace can be created in OPFS', async ({ page }) => {
    await page.goto('/');
    await clearOpfs(page);
    await setupVirtualWorkspace(page, { workspaceName: 'smoke-test-ws' });

    const handleExists = await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      try {
        await root.getDirectoryHandle('smoke-test-ws');
        return true;
      } catch {
        return false;
      }
    });

    expect(handleExists).toBe(true);
  });
});
