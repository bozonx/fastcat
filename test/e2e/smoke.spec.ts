import { test, expect } from '@playwright/test';

test('E2E Smoke Test', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Gran Video Editor/);
});
