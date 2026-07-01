import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Timeline interaction primitives for web e2e specs.
 *
 * The timeline is already DOM-addressable without bespoke test ids:
 *   - each clip root carries `data-clip-id="<itemId>"`
 *   - each gap carries `data-gap-id`
 *   - each track lane carries `data-track-id="<trackId>"`
 *   - trim handles carry `data-testid="clip-trim-start|clip-trim-end"`
 *
 * Geometry is measured from real bounding boxes rather than recomputed from the
 * store zoom, so drags stay correct regardless of the current timeline scale.
 * That is the deliberate difference from the unit tests: here we move real
 * pixels through the real pointer/DnD pipeline and then assert on the persisted
 * OTIO document (see ./otio.ts).
 */

export function timelineContainer(page: Page): Locator {
  return page.getByTestId('timeline-container');
}

export function clip(page: Page, clipId?: string): Locator {
  return clipId ? page.locator(`[data-clip-id="${clipId}"]`) : page.locator('[data-clip-id]');
}

export function track(page: Page, trackId: string): Locator {
  return page.locator(`[data-track-id="${trackId}"]`);
}

/** Every rendered clip id, in DOM order. */
export async function clipIds(page: Page): Promise<string[]> {
  return clip(page).evaluateAll((els) =>
    els.map((el) => el.getAttribute('data-clip-id') ?? '').filter(Boolean),
  );
}

/** Every rendered track id, in DOM order. */
export async function trackIds(page: Page): Promise<string[]> {
  return page
    .locator('[data-track-id]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-track-id') ?? '').filter(Boolean));
}

export async function selectClip(page: Page, clipId: string): Promise<void> {
  await clip(page, clipId).click();
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function requireBox(locator: Locator, what: string): Promise<Box> {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${what}: element has no bounding box (not visible?)`);
  return box;
}

export async function clipBox(page: Page, clipId: string): Promise<Box> {
  return requireBox(clip(page, clipId), `clip ${clipId}`);
}

/**
 * Drags a clip horizontally by `deltaPx` on its own track. Positive moves it
 * later. Uses a real press-move-release pointer gesture (steps let the app's
 * move-preview / snap logic run) rather than a synthetic event.
 */
export async function dragClipBy(
  page: Page,
  clipId: string,
  deltaPx: { x: number; y?: number },
): Promise<void> {
  const box = await clipBox(page, clipId);
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // A small initial nudge crosses the click-vs-drag threshold before the move.
  await page.mouse.move(startX + 3, startY, { steps: 3 });
  await page.mouse.move(startX + deltaPx.x, startY + (deltaPx.y ?? 0), { steps: 12 });
  await page.mouse.up();
}

/**
 * Drags one trim handle of a clip by `deltaPx`. Positive `deltaPx` extends to
 * the right; the app clamps at source/min-duration bounds, which specs assert.
 */
export async function trimClipEdge(
  page: Page,
  clipId: string,
  edge: 'start' | 'end',
  deltaPx: number,
): Promise<void> {
  const clipEl = clip(page, clipId);
  // Hover reveals the handle (opacity-0 until group-hover) before we grab it.
  await clipEl.hover();
  const handle = clipEl.getByTestId(edge === 'start' ? 'clip-trim-start' : 'clip-trim-end');
  const box = await requireBox(handle, `${edge} trim handle of ${clipId}`);
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaPx, startY, { steps: 12 });
  await page.mouse.up();
}

/**
 * Adds a media file from the file manager onto a timeline track.
 *
 * fastcat's drag payload lives in a module-level ref that the file browser sets
 * in its own `dragstart` handler — it is *not* carried solely on
 * `dataTransfer`. Simulating a bare mouse drag therefore does not register the
 * drop. Instead we fire the app's real HTML5 drag sequence
 * (dragstart → dragover → drop) with a shared DataTransfer, so the app's own
 * handlers run exactly as they do for a user. This is the robust,
 * non-flaky way to exercise DnD in Playwright.
 */
export async function addFileToTrack(
  page: Page,
  entryPath: string,
  trackId: string,
): Promise<void> {
  const source = page.locator(`[data-entry-path="${entryPath}"]`);
  const target = track(page, trackId);
  await expect(source, `file entry ${entryPath}`).toBeVisible();
  await expect(target, `track ${trackId}`).toBeVisible();

  await page.evaluate(
    ({ entryPath: ep, trackId: tid }) => {
      const src = document.querySelector<HTMLElement>(`[data-entry-path="${ep}"]`);
      const dst = document.querySelector<HTMLElement>(`[data-track-id="${tid}"]`);
      if (!src || !dst) throw new Error('drag source or target not found');

      const dataTransfer = new DataTransfer();
      const rect = dst.getBoundingClientRect();
      // Drop a little in from the left edge of the track.
      const clientX = rect.left + Math.min(60, rect.width / 2);
      const clientY = rect.top + rect.height / 2;

      const fire = (el: HTMLElement, type: string, target?: HTMLElement) =>
        el.dispatchEvent(
          new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            dataTransfer,
            clientX,
            clientY,
          } as DragEventInit),
        ) && void (target ?? el);

      fire(src, 'dragstart');
      fire(dst, 'dragenter');
      fire(dst, 'dragover');
      fire(dst, 'drop');
      fire(src, 'dragend');
    },
    { entryPath, trackId },
  );
}
