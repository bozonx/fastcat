import { test, expect } from '@playwright/test';

test.describe('Smoke: Page Loading', () => {
  test('index page loads with correct title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/FastCat/);
  });

  test('embedded page loads without uncaught errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/test/embedded');
    await expect(page).toHaveTitle(/FastCat/);
    await expect(page.locator('body')).toBeVisible();
    await page.waitForFunction(() => document.querySelector('#__nuxt')?.children.length);

    // We do not assert on UI readiness here because the embedded layout
    // fetches external assets over the network; in CI/headless those
    // requests may be slow or blocked. We only verify the shell loaded.
    expect(errors).toEqual([]);
  });
});
