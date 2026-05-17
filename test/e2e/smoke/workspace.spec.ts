import { test, expect } from '@playwright/test';

test.describe('Smoke: Workspace Initialization', () => {
  test('embedded workspace initializes in OPFS automatically', async ({ page }) => {
    await page.goto('/test/embedded');

    // Wait for the editor to finish initialization.
    await expect(
      page.getByText('Fastcat Editor'),
    ).toBeVisible({ timeout: 15_000 });

    // Verify the workspace store created a handle.
    const hasWorkspaceHandle = await page.evaluate(async () => {
      // The workspace store is globally accessible through Pinia in dev mode.
      const pinia = (window as any).__pinia;
      if (!pinia) return false;

      const workspace = pinia.state.value.workspace;
      return workspace?.workspaceHandle !== null && workspace?.workspaceHandle !== undefined;
    });

    expect(hasWorkspaceHandle).toBe(true);
  });

  test('OPFS is supported in the test browser', async ({ page }) => {
    const isOpfsSupported = await page.evaluate(() => {
      return typeof navigator !== 'undefined' && 'storage' in navigator && 'getDirectory' in navigator.storage;
    });

    expect(isOpfsSupported).toBe(true);
  });
});
