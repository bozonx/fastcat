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

  test('Cross-Origin Isolation and SharedArrayBuffer are enabled', async ({ page }) => {
    await page.goto('/');
    const isIsolated = await page.evaluate(() => {
      return (
        globalThis.crossOriginIsolated === true &&
        typeof SharedArrayBuffer === 'function'
      );
    });

    expect(isIsolated).toBe(true);
  });

  test('OPFS sync access handle is supported inside Web Worker', async ({ page }, testInfo) => {
    const fileName = `smoke-sync-handle-${testInfo.workerIndex}-${testInfo.retry}.bin`;

    await page.goto('/');
    const workerResult = await page.evaluate(async (file) => {
      const script = `
        self.onmessage = async (e) => {
          try {
            const root = await navigator.storage.getDirectory();
            const handle = await root.getFileHandle(e.data.fileName, { create: true });
            const accessHandle = await handle.createSyncAccessHandle();
            const writeBuffer = new Uint8Array([1, 2, 3, 4]);
            accessHandle.write(writeBuffer, { at: 0 });
            accessHandle.flush();
            accessHandle.close();
            await root.removeEntry(e.data.fileName);
            self.postMessage({ success: true });
          } catch (err) {
            self.postMessage({ success: false, error: String(err) });
          }
        };
      `;
      const blob = new Blob([script], { type: 'text/javascript' });
      const url = URL.createObjectURL(blob);
      const worker = new Worker(url);

      return new Promise<{ success: boolean; error?: string }>((resolve) => {
        worker.onmessage = (e) => {
          URL.revokeObjectURL(url);
          worker.terminate();
          resolve(e.data);
        };
        worker.postMessage({ fileName: file });
      });
    }, fileName);

    expect(workerResult.success, workerResult.error ?? 'Unknown worker error').toBe(true);
  });
});
