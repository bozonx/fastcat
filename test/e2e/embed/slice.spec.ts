import { expect, test, type Page } from '@playwright/test';
import { embedHostUrl } from '../../../scripts/lib/preview-server.mjs';

/**
 * Drives the editor exactly as a third-party integration does: from a host page
 * on a different origin, over postMessage only, without cross-origin isolation.
 *
 * These specs guard the published contract rather than the editor's UI — if a
 * change here breaks, every embedding site breaks with it.
 */

const HOST_URL = embedHostUrl(
  process.env.E2E_HOST ?? '127.0.0.1',
  Number(process.env.E2E_PORT ?? 3007),
);

interface StandState {
  phase: string;
  capabilities: {
    webgpu: boolean;
    webcodecs: boolean;
    opfs: boolean;
    sharedArrayBuffer: boolean;
  } | null;
  initialized: { assetCount: number; durationMs: number } | null;
  streamedBytes: number;
  result: { filename: string; mimeType: string; sizeBytes: number; streamedBytes: number } | null;
  readingExport: boolean;
  errors: { code: string; message: string }[];
  messages: { direction: 'in' | 'out'; type: string }[];
}

function readStand(page: Page): Promise<StandState> {
  return page.evaluate(() => {
    const stand = (window as unknown as { __embedStand: StandState }).__embedStand;
    // Strip the retained Blob before it crosses the CDP boundary.
    const {
      phase,
      capabilities,
      initialized,
      streamedBytes,
      result,
      readingExport,
      errors,
      messages,
    } = stand;
    return {
      phase,
      capabilities,
      initialized,
      streamedBytes,
      result,
      readingExport,
      errors,
      messages,
    };
  }) as Promise<StandState>;
}

async function openStand(page: Page) {
  await page.goto(`${HOST_URL}/?autostart=1`);
  await expect
    .poll(async () => (await readStand(page)).initialized?.assetCount ?? null, { timeout: 60_000 })
    .not.toBeNull();
}

test.describe('Embed: host integration', () => {
  test.slow();

  test('completes the handshake and lays the host asset onto the timeline', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await openStand(page);
    const stand = await readStand(page);

    expect(stand.initialized).toMatchObject({ assetCount: 1 });
    expect(stand.initialized!.durationMs).toBeGreaterThan(0);
    expect(stand.errors).toEqual([]);
    expect(pageErrors).toEqual([]);

    expect(stand.capabilities).toMatchObject({ opfs: true, webcodecs: true });
    // The embed route opts out of cross-origin isolation on purpose; a `true`
    // here means a header rule regressed and the no-SharedArrayBuffer path is
    // no longer being exercised.
    expect(stand.capabilities!.sharedArrayBuffer).toBe(false);
  });

  test('ignores messages that do not carry the handshake nonce', async ({ page }) => {
    await openStand(page);

    await page.evaluate(() => {
      const iframe = document.querySelector('iframe');
      iframe?.contentWindow?.postMessage(
        {
          channel: 'fastcat-embed',
          version: 1,
          nonce: 'not-the-nonce',
          type: 'dispose',
          payload: undefined,
        },
        '*',
      );
    });

    // A honoured `dispose` would tear the workspace down; the session must be
    // untouched and still able to export.
    await page.waitForTimeout(1_000);
    await expect(page.getByTestId('stand-export')).toBeEnabled();
    expect((await readStand(page)).errors).toEqual([]);
  });

  test('hands the rendered file back and releases it only after the host reads it', async ({
    page,
  }) => {
    await openStand(page);
    await page.getByTestId('stand-export').click();

    await expect
      .poll(async () => (await readStand(page)).result, { timeout: 120_000 })
      .not.toBeNull();

    const stand = await readStand(page);
    expect(stand.result!.filename).toMatch(/\.(mp4|webm|mkv)$/i);
    expect(stand.result!.sizeBytes).toBeGreaterThan(0);
    // Drained through `file.stream()` on the host side: proves the file crossed
    // by reference and stayed readable there.
    expect(stand.streamedBytes).toBe(stand.result!.sizeBytes);
    expect(stand.readingExport).toBe(false);

    const doneIndex = stand.messages.findIndex(
      (m) => m.direction === 'in' && m.type === 'export:done',
    );
    const ackIndex = stand.messages.findIndex(
      (m) => m.direction === 'out' && m.type === 'export:ack',
    );
    expect(doneIndex).toBeGreaterThanOrEqual(0);
    expect(ackIndex).toBeGreaterThan(doneIndex);
  });
});
