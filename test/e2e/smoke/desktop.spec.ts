import { test, expect } from '@playwright/test';
import { mockTauriInternals } from '../../utils/e2e/tauri-mocks';

test.describe('Smoke: Desktop Mode (Tauri mocks)', () => {
  test.beforeEach(async ({ page }) => {
    await mockTauriInternals(page);
  });

  test('app detects mocked Tauri environment', async ({ page }) => {
    await page.goto('/');

    const isTauri = await page.evaluate(() => {
      return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    });

    expect(isTauri).toBe(true);
  });

  test('index page loads in mocked Tauri context', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/FastCat/);
  });
});
