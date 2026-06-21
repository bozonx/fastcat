import { test, expect } from '@playwright/test';
import { probeWebGpu } from '../../utils/e2e/webgpu';

test.describe('Smoke: WebGPU availability', () => {
  test('WebGPU adapter is reachable in the app origin context', async ({ page }) => {
    // navigator.gpu is only exposed on a secure context, so navigate first.
    await page.goto('/');

    const info = await probeWebGpu(page);

    expect(info.available, info.reason ?? 'no reason').toBe(true);
  });
});
