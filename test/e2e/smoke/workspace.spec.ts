import { test, expect } from '@playwright/test';
import { removeOpfsEntry, setupVirtualWorkspace } from '../../utils/e2e/virtual-fs';

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

  test('virtual workspace can be created in OPFS', async ({ page }, testInfo) => {
    const workspaceName = `smoke-test-ws-${testInfo.workerIndex}-${testInfo.retry}`;

    await page.goto('/');
    await removeOpfsEntry(page, workspaceName);
    await setupVirtualWorkspace(page, { workspaceName });

    const handleExists = await page.evaluate(async (name) => {
      const root = await navigator.storage.getDirectory();
      try {
        await root.getDirectoryHandle(name);
        return true;
      } catch {
        return false;
      }
    }, workspaceName);

    expect(handleExists).toBe(true);
  });
});
