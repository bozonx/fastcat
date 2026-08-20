import { test, expect } from '@playwright/test';

test.describe('Smoke: Page Loading', () => {
  test('index page loads with correct title and without uncaught errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');
    await expect(page).toHaveTitle(/FastCat/);
    expect(errors).toEqual([]);
  });
});
