import { test, expect } from '@playwright/test';

test.describe('Smoke: Page Loading', () => {
  test('index page loads with correct title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/FastCat/);
  });

  test('embedded page loads and renders editor chrome', async ({ page }) => {
    await page.goto('/test/embedded');
    await expect(page).toHaveTitle(/FastCat/);

    // The embedded layout shows a spinner while initializing,
    // then renders the editor header with the export button.
    await expect(
      page.getByRole('button', { name: /export/i }),
    ).toBeVisible({ timeout: 15_000 });

    // Error overlay should never appear.
    const errorOverlay = page.locator('text=Error Initializing Editor');
    await expect(errorOverlay).not.toBeVisible();
  });
});
