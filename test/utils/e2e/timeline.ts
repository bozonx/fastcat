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
  return page.locator(`[data-track-id="${trackId}"]`).last();
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

/**
 * Fits the timeline zoom so the clip(s) are wide enough for reliable pointer
 * gestures. This is a real user action (the "zoom to fit" hotkey), not a
 * hidden hook; it is only used as a setup step before the actual interaction.
 */
async function fitTimelineZoom(page: Page): Promise<void> {
  await timelineContainer(page).click();
  await page.keyboard.press('Shift+0');
  await page.waitForTimeout(150);
}

export async function clipBox(page: Page, clipId: string): Promise<Box> {
  return requireBox(clip(page, clipId), `clip ${clipId}`);
}

/**
 * Moves a clip horizontally by `deltaUs` microseconds on its own track.
 * Uses a direct e2e hook (applyTimeline + saveTimeline) instead of mouse-based
 * dragging, which is unreliable for small clips.
 */
export async function dragClipBy(
  page: Page,
  clipId: string,
  deltaUs: { x: number },
): Promise<void> {
  await page.evaluate(
    async (params) => {
      const fn = (
        window as Window & {
          __fastcatE2eMoveClip?: (p: { itemId: string; deltaUs: number }) => Promise<void>;
        }
      ).__fastcatE2eMoveClip;
      if (!fn) throw new Error('E2E move clip hook is not registered');
      await fn(params);
    },
    { itemId: clipId, deltaUs: deltaUs.x },
  );
}

/**
 * Moves a clip to a different track. Uses a direct e2e hook
 * (applyTimeline + saveTimeline) instead of mouse-based dragging.
 */
export async function moveClipToTrack(
  page: Page,
  clipId: string,
  toTrackId: string,
): Promise<void> {
  await page.evaluate(
    async (params) => {
      const fn = (
        window as Window & {
          __fastcatE2eMoveClipToTrack?: (p: { itemId: string; toTrackId: string }) => Promise<void>;
        }
      ).__fastcatE2eMoveClipToTrack;
      if (!fn) throw new Error('E2E move clip to track hook is not registered');
      await fn(params);
    },
    { itemId: clipId, toTrackId },
  );
}

export async function deleteClip(page: Page, clipId: string): Promise<void> {
  await selectClip(page, clipId);
  await deleteSelectedItems(page);
}

/**
 * Trims a clip edge by `deltaUs` microseconds. Uses a direct e2e hook
 * (applyTimeline + saveTimeline) instead of mouse-based trim handle dragging,
 * which is unreliable for small clips (10px wide at default zoom).
 */
export async function trimClipEdge(
  page: Page,
  clipId: string,
  edge: 'start' | 'end',
  deltaUs: number,
): Promise<void> {
  await page.evaluate(
    async (params) => {
      const fn = (
        window as Window & {
          __fastcatE2eTrimClip?: (p: {
            itemId: string;
            edge: 'start' | 'end';
            deltaUs: number;
          }) => Promise<void>;
        }
      ).__fastcatE2eTrimClip;
      if (!fn) throw new Error('E2E trim clip hook is not registered');
      await fn(params);
    },
    { itemId: clipId, edge, deltaUs },
  );
}

/**
 * Adds a media file from the file manager onto a timeline track.
 *
 * This drives the app's real pointer-based drag-and-drop engine:
 *   1. pointerdown on the file entry sets the module-level dragged-file ref
 *   2. moving past the gesture threshold commits the internal drag
 *   3. pointerup over the track lane triggers the timeline drop zone
 * The file payload is carried exactly as it would be for a user drag.
 */
export async function addFileToTrack(
  page: Page,
  entryPath: string,
  trackId: string,
): Promise<void> {
  const source = page
    .locator(`[data-entry-path="${entryPath}"], [data-entry-path$="/${entryPath}"]`)
    .first();
  const target = track(page, trackId);
  if ((await source.count()) > 0) {
    await expect(source, `file entry ${entryPath}`).toBeVisible();
  }
  await expect(target, `track ${trackId}`).toBeVisible();

  // Wait for the file entry's compatibility check to finish — the pointerdown
  // handler is gated by isCheckingCompatibility and silently swallows the
  // event while metadata is still loading (spinner visible inside the entry).
  const compatSpinner = source.locator('.animate-spin');
  if ((await compatSpinner.count()) > 0) {
    await expect(compatSpinner, `compatibility check for ${entryPath}`).toBeHidden({
      timeout: 15_000,
    });
  }

  await fitTimelineZoom(page);

  const sourceBox = await requireBox(source, `file entry ${entryPath}`);
  const targetBox = await requireBox(target, `track ${trackId}`);
  const startX = sourceBox.x + sourceBox.width / 2;
  const startY = sourceBox.y + sourceBox.height / 2;
  const endX = targetBox.x + Math.min(40, Math.max(8, targetBox.width / 10));
  const endY = targetBox.y + targetBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Move past the pointer-DnD threshold so the file manager commits the drag.
  await page.mouse.move(startX + 10, startY + 10, { steps: 2 });
  await page.mouse.move(endX, endY, { steps: 10 });
  await page.mouse.up();
}

export async function undoTimeline(page: Page): Promise<void> {
  await timelineContainer(page).click();
  await page.keyboard.press('Control+z');
}

export async function redoTimeline(page: Page): Promise<void> {
  await timelineContainer(page).click();
  await page.keyboard.press('Control+y');
}

export async function setCurrentTimeUs(page: Page, us: number): Promise<void> {
  await page.evaluate(
    async ({ us: targetUs }) => {
      const setTime = (
        window as Window & {
          __fastcatE2eSetCurrentTimeUs?: (params: { us: number }) => Promise<void>;
        }
      ).__fastcatE2eSetCurrentTimeUs;
      if (!setTime) throw new Error('E2E timeline set-current-time hook is not registered');
      await setTime({ us: targetUs });
    },
    { us: Math.max(0, Math.round(us)) },
  );
}

export async function splitClipAtPlayhead(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const split = (window as Window & { __fastcatE2eSplitClipAtPlayhead?: () => Promise<void> })
      .__fastcatE2eSplitClipAtPlayhead;
    if (!split) throw new Error('E2E timeline split hook is not registered');
    await split();
  });
}

export async function selectTimelineClipsById(page: Page, itemIds: string[]): Promise<void> {
  await page.evaluate(
    async ({ itemIds: ids }) => {
      const select = (
        window as Window & {
          __fastcatE2eSelectTimelineItems?: (params: { itemIds: string[] }) => Promise<void>;
        }
      ).__fastcatE2eSelectTimelineItems;
      if (!select) throw new Error('E2E timeline select hook is not registered');
      await select({ itemIds: ids });
    },
    { itemIds: itemIds },
  );
}

export async function getSelectedItemIds(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const getSelected = (
      window as Window & { __fastcatE2eGetSelectedItemIds?: () => Promise<string[]> }
    ).__fastcatE2eGetSelectedItemIds;
    if (!getSelected) throw new Error('E2E timeline get-selected hook is not registered');
    return getSelected();
  });
}

export async function deleteSelectedItems(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const del = (window as Window & { __fastcatE2eDeleteSelectedItems?: () => Promise<void> })
      .__fastcatE2eDeleteSelectedItems;
    if (!del) throw new Error('E2E timeline delete-selected hook is not registered');
    await del();
  });
}

export async function updateClipProperties(
  page: Page,
  params: { itemId: string; properties: Record<string, unknown> },
): Promise<void> {
  await page.evaluate(
    async ({ itemId, properties }) => {
      const update = (
        window as Window & {
          __fastcatE2eUpdateClipProperties?: (params: {
            itemId: string;
            properties: Record<string, unknown>;
          }) => Promise<void>;
        }
      ).__fastcatE2eUpdateClipProperties;
      if (!update) throw new Error('E2E timeline update-clip-properties hook is not registered');
      await update({ itemId, properties });
    },
    { itemId: params.itemId, properties: params.properties },
  );
}

export async function saveTimeline(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const save = (window as Window & { __fastcatE2eSaveTimeline?: () => Promise<void> })
      .__fastcatE2eSaveTimeline;
    if (!save) throw new Error('E2E timeline save hook is not registered');
    await save();
  });
}

export async function setTimelineZoom(page: Page, zoom: number): Promise<void> {
  await page.evaluate(async (z) => {
    const set = (
      window as Window & { __fastcatE2eSetTimelineZoom?: (p: { zoom: number }) => Promise<void> }
    ).__fastcatE2eSetTimelineZoom;
    if (!set) throw new Error('E2E timeline set-zoom hook is not registered');
    await set({ zoom: z });
  }, zoom);
}

export async function getTimelineDocInfo(page: Page): Promise<{
  duration: number;
  trackCount: number;
  tracks: Array<{
    id: string;
    kind: string;
    videoHidden?: boolean;
    clipCount: number;
    clipTypes: Array<string | undefined>;
  }>;
}> {
  return page.evaluate(() => {
    const getInfo = (
      window as Window & {
        __fastcatE2eGetTimelineDocInfo?: () => {
          duration: number;
          trackCount: number;
          tracks: Array<{
            id: string;
            kind: string;
            videoHidden?: boolean;
            clipCount: number;
            clipTypes: Array<string | undefined>;
          }>;
        };
      }
    ).__fastcatE2eGetTimelineDocInfo;
    if (!getInfo) throw new Error('E2E get timeline doc info hook is not registered');
    return getInfo();
  });
}

export async function addTextClipAtPlayhead(
  page: Page,
  params: {
    text?: string;
    style?: Record<string, unknown>;
    durationUs?: number;
    trackId?: string;
  },
): Promise<string[]> {
  return page.evaluate(async (input) => {
    const addText = (
      window as Window & {
        __fastcatE2eAddTextClip?: (params: {
          text?: string;
          style?: Record<string, unknown>;
          durationUs?: number;
          trackId?: string;
        }) => Promise<string[]>;
      }
    ).__fastcatE2eAddTextClip;
    if (!addText) throw new Error('E2E timeline add-text hook is not registered');
    return addText(input);
  }, params);
}
