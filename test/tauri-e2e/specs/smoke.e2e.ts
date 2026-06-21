import { browser, expect, $ } from '@wdio/globals';

/**
 * Smoke test against the real Tauri (WebKitGTK) build.
 *
 * Unlike the Playwright web suite, this runs inside the actual native webview
 * with the real Rust backend, so IPC / fs / native commands are genuinely
 * exercised rather than mocked.
 */
describe('Tauri smoke', () => {
  it('boots the FastCat window and renders the app shell', async () => {
    // The app shell mounts under #__nuxt (Nuxt root).
    const root = await $('#__nuxt');
    await root.waitForExist({ timeout: 30_000 });
    await expect(root).toBeExisting();
  });

  it('runs inside a real Tauri webview (not the web build)', async () => {
    const isTauri = await browser.execute(() => '__TAURI_INTERNALS__' in window);
    expect(isTauri).toBe(true);
  });

  it('exposes the document title', async () => {
    await expect(browser).toHaveTitle(/FastCat/);
  });
});
