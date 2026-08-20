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
  initialized: {
    assetCount: number;
    durationMs: number;
    layout: 'desktop' | 'mobile';
    reclaimedSessions: number;
  } | null;
  streamedBytes: number;
  result: {
    filename: string;
    mimeType: string;
    sizeBytes: number;
    streamedBytes: number;
    width: number | null;
    height: number | null;
    durationMs: number | null;
    fps: number | null;
    posterBytes: number;
    otioLength: number;
  } | null;
  readingExport: boolean;
  assetProgress: Record<string, { loadedBytes: number; totalBytes: number | null }>;
  urlRefreshes: number;
  preferences: unknown;
  preferenceUpdates: number;
  lastChange: { dirty: boolean; otioLength: number } | null;
  closeRequests: number;
  resizeRequests: number[];
  errors: { code: string; message: string }[];
  messages: { direction: 'in' | 'out'; type: string }[];
}

function readStand(page: Page): Promise<StandState> {
  return page.evaluate(() => {
    const stand = (window as unknown as { __embedStand: Record<string, unknown> }).__embedStand;
    // Copy field by field: the stand also retains the exported Blob, which
    // cannot cross the CDP boundary.
    const keys = [
      'phase',
      'capabilities',
      'initialized',
      'streamedBytes',
      'result',
      'readingExport',
      'assetProgress',
      'urlRefreshes',
      'preferences',
      'preferenceUpdates',
      'lastChange',
      'closeRequests',
      'resizeRequests',
      'errors',
      'messages',
    ] as const;
    return Object.fromEntries(keys.map((key) => [key, stand[key]]));
  }) as Promise<StandState>;
}

async function openStand(page: Page, query = '') {
  await page.goto(`${HOST_URL}/?autostart=1${query}`);
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

  test('picks the shell from the container size and keeps it across a resize', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await openStand(page);

    expect((await readStand(page)).initialized!.layout).toBe('desktop');
    const root = page.frameLocator('iframe').locator('[data-layout-mode]');
    await expect(root).toHaveAttribute('data-layout-mode', 'desktop');

    // A shell that flipped here would throw away the arrangement every time the
    // host resized its container, so the choice must survive.
    await page.setViewportSize({ width: 520, height: 900 });
    await page.waitForTimeout(500);
    await expect(root).toHaveAttribute('data-layout-mode', 'desktop');
  });

  test('honours an explicit layout from the host', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await openStand(page, '&layout=mobile');

    expect((await readStand(page)).initialized!.layout).toBe('mobile');
    await expect(page.frameLocator('iframe').locator('[data-layout-mode]')).toHaveAttribute(
      'data-layout-mode',
      'mobile',
    );
  });

  test('offers only the views the host switched on', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await openStand(page);

    const frame = page.frameLocator('iframe');
    // The default profile is the timeline plus an export; nothing else.
    await expect(frame.getByTestId('embed-view-cut')).toBeVisible();
    await expect(frame.getByTestId('embed-view-export')).toBeVisible();
    await expect(frame.getByTestId('embed-view-files')).toHaveCount(0);
    await expect(frame.getByTestId('embed-view-sound')).toHaveCount(0);

    // The embedded workspace is owned by the host, so it must not expose its
    // transient file browser or backups. Editing tabs remain available.
    await expect(frame.locator('[data-tab-id="files"]')).toHaveCount(0);
    await expect(frame.locator('[data-tab-id="backups"]')).toHaveCount(0);
    await expect(frame.locator('[data-tab-id="effects"]')).toBeVisible();
    await expect(frame.locator('[data-tab-id="markers"]')).toBeVisible();
    await expect(frame.locator('[data-panel-id]')).toHaveCount(3);
  });

  test('lays out the monitor and timeline without overlapping the project panel', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await openStand(page);

    const frame = page.frameLocator('iframe');
    const projectPanel = frame.locator('[data-panel-id="fileManager"]');
    const monitorPanel = frame.locator('[data-panel-id="monitor"]');
    const timeline = frame.getByTestId('timeline-container');

    await expect(projectPanel).toBeVisible();
    await expect(monitorPanel).toBeVisible();
    await expect(timeline).toBeVisible();

    const projectBox = await projectPanel.boundingBox();
    const monitorBox = await monitorPanel.boundingBox();
    const timelineBox = await timeline.boundingBox();

    expect(projectBox).not.toBeNull();
    expect(monitorBox).not.toBeNull();
    expect(timelineBox).not.toBeNull();
    expect(monitorBox!.x).toBeGreaterThanOrEqual(projectBox!.x + projectBox!.width - 2);
    expect(timelineBox!.y).toBeGreaterThanOrEqual(projectBox!.y + projectBox!.height - 2);
    expect(timelineBox!.y).toBeGreaterThanOrEqual(monitorBox!.y + monitorBox!.height - 2);
  });

  test('switches shells on request without losing the session', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await openStand(page);

    const frame = page.frameLocator('iframe');
    const root = frame.locator('[data-layout-mode]');
    await expect(root).toHaveAttribute('data-layout-mode', 'desktop');

    await frame.getByTestId('embed-toggle-layout').click();
    await expect(root).toHaveAttribute('data-layout-mode', 'mobile');

    // The stores are shared across shells, so the loaded asset is still there
    // and an export is still possible.
    await expect(frame.getByTestId('embed-export')).toBeEnabled();
    expect((await readStand(page)).errors).toEqual([]);
  });

  test('reclaims storage from a session that was torn down without disposing', async ({ page }) => {
    await openStand(page);
    // Nothing preceded this one in a fresh browser context.
    expect((await readStand(page)).initialized!.reclaimedSessions).toBe(0);

    // Reloading kills the iframe outright — no `dispose`, exactly what a closed
    // tab or a crash looks like from the editor's side.
    await page.reload();
    await openStand(page);

    expect((await readStand(page)).initialized!.reclaimedSessions).toBeGreaterThanOrEqual(1);
  });

  test('reports asset download progress against a known total', async ({ page }) => {
    await openStand(page);

    const { assetProgress } = await readStand(page);
    const entries = Object.values(assetProgress);
    expect(entries.length).toBeGreaterThan(0);

    const last = entries[entries.length - 1]!;
    // The server advertises a size, so progress ends exactly at the total
    // rather than trailing off at an unknown fraction.
    expect(last.totalBytes).toBeGreaterThan(0);
    expect(last.loadedBytes).toBe(last.totalBytes);
  });

  test('recovers when an asset URL expires mid-import', async ({ page }) => {
    await openStand(page, '&expiring=1');

    const stand = await readStand(page);
    expect(stand.urlRefreshes).toBeGreaterThanOrEqual(1);
    // The refreshed URL carried the import through: the clip still landed.
    expect(stand.initialized!.assetCount).toBe(1);
    expect(stand.initialized!.durationMs).toBeGreaterThan(0);
  });

  test('hands the timeline to the host on request', async ({ page }) => {
    await openStand(page);
    await page.getByTestId('stand-save').click();

    await expect.poll(async () => (await readStand(page)).lastChange).not.toBeNull();
    const { lastChange } = await readStand(page);
    // A real OTIO document, not an empty placeholder.
    expect(lastChange!.otioLength).toBeGreaterThan(100);
  });

  test('returns preferences to the host and takes them back next session', async ({ page }) => {
    await openStand(page);
    await page.getByTestId('stand-dispose').click();

    // Disposing flushes whatever is still behind the debounce, so the host
    // never loses the last edit to a preference.
    await expect.poll(async () => (await readStand(page)).preferenceUpdates).toBeGreaterThan(0);
    const stored = (await readStand(page)).preferences as { version: number } | null;
    expect(stored?.version).toBe(1);

    // The stand replays what it stored on the next open; an editor that
    // rejected its own payload would report an error.
    await page.reload();
    await openStand(page);
    expect((await readStand(page)).errors).toEqual([]);
  });

  test('describes the render from the finished file, with a poster and its timeline', async ({
    page,
  }) => {
    await openStand(page);
    await page.getByTestId('stand-export').click();

    await expect
      .poll(async () => (await readStand(page)).result, { timeout: 120_000 })
      .not.toBeNull();

    const { result } = await readStand(page);
    // Read back off the exported bytes, so these cannot disagree with the file.
    expect(result!.width).toBeGreaterThan(0);
    expect(result!.height).toBeGreaterThan(0);
    expect(result!.durationMs).toBeGreaterThan(0);
    expect(result!.fps).toBeGreaterThan(0);
    // A poster the host can put on a card, and the timeline behind the render
    // so it can offer "edit again" instead of starting over.
    expect(result!.posterBytes).toBeGreaterThan(0);
    expect(result!.otioLength).toBeGreaterThan(100);
  });

  test('starts from the composition the host asked for', async ({ page }) => {
    // A 9:16 story, whatever shape the source footage happens to be.
    await openStand(page, '&width=1080&height=1920&fps=30');
    await page.getByTestId('stand-export').click();

    await expect
      .poll(async () => (await readStand(page)).result, { timeout: 120_000 })
      .not.toBeNull();

    const { result } = await readStand(page);
    expect(result!.width).toBe(1080);
    expect(result!.height).toBe(1920);
  });

  test('takes assets added after the session started', async ({ page }) => {
    await openStand(page);
    expect((await readStand(page)).initialized!.assetCount).toBe(1);

    await page.getByTestId('stand-add-asset').click();

    const frame = page.frameLocator('iframe');
    await expect(frame.getByTestId('embed-export')).toBeEnabled({ timeout: 30_000 });
    expect((await readStand(page)).errors).toEqual([]);
  });

  test('routes its own close control to the host rather than acting alone', async ({ page }) => {
    await openStand(page);
    await page.frameLocator('iframe').getByTestId('embed-close').click();

    // The host owns the frame, so the editor asks rather than tears itself down.
    await expect.poll(async () => (await readStand(page)).closeRequests).toBe(1);
    await expect(page.frameLocator('iframe').getByTestId('embed-shell')).toBeVisible();
  });

  test('asks for room when the frame is too short to work in', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 420 });
    await openStand(page);

    const { resizeRequests } = await readStand(page);
    expect(resizeRequests.length).toBeGreaterThan(0);
    expect(resizeRequests[0]).toBeGreaterThan(420);
  });

  test('streams the render to the host endpoint in upload mode', async ({ page }) => {
    await openStand(page, '&output=upload');
    await page.getByTestId('stand-export').click();

    await expect
      .poll(async () => (await readStand(page)).result, { timeout: 120_000 })
      .not.toBeNull();

    const stand = await readStand(page);
    // The bytes reached the host's endpoint without ever crossing the message
    // channel — this is the path for renders too large to hand over as a Blob.
    expect(stand.streamedBytes).toBeGreaterThan(0);
    expect(stand.result!.sizeBytes).toBe(stand.streamedBytes);
    // The metadata and poster still come back; only the file itself does not.
    expect(stand.result!.posterBytes).toBeGreaterThan(0);
    expect(stand.errors).toEqual([]);
  });
});
