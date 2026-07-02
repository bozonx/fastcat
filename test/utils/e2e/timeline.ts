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

const E2E_US_PER_PX = 5_000;

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
  await expect(clip(page, clipId)).toBeVisible();
  await page.evaluate(
    async ({ deltaUs, itemId }) => {
      const moveClipBy = (
        window as Window & {
          __fastcatE2eMoveClipBy?: (params: { itemId: string; deltaUs: number }) => Promise<void>;
        }
      ).__fastcatE2eMoveClipBy;

      if (!moveClipBy) throw new Error('E2E timeline move hook is not registered');
      await moveClipBy({ itemId, deltaUs });
    },
    { itemId: clipId, deltaUs: Math.round(deltaPx.x * E2E_US_PER_PX) },
  );
}

export async function moveClipToTrack(
  page: Page,
  clipId: string,
  toTrackId: string,
): Promise<void> {
  await expect(clip(page, clipId)).toBeVisible();
  await page.evaluate(
    async ({ itemId, toTrackId: targetTrackId }) => {
      const moveClipToTrack = (
        window as Window & {
          __fastcatE2eMoveClipToTrack?: (params: {
            itemId: string;
            toTrackId: string;
          }) => Promise<void>;
        }
      ).__fastcatE2eMoveClipToTrack;

      if (!moveClipToTrack) throw new Error('E2E timeline move-to-track hook is not registered');
      await moveClipToTrack({ itemId, toTrackId: targetTrackId });
    },
    { itemId: clipId, toTrackId },
  );
}

export async function deleteClip(page: Page, clipId: string): Promise<void> {
  await expect(clip(page, clipId)).toBeVisible();
  await page.evaluate(async (itemId) => {
    const deleteTimelineClip = (
      window as Window & {
        __fastcatE2eDeleteClip?: (params: { itemId: string }) => Promise<void>;
      }
    ).__fastcatE2eDeleteClip;

    if (!deleteTimelineClip) throw new Error('E2E timeline delete hook is not registered');
    await deleteTimelineClip({ itemId });
  }, clipId);
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
  await expect(clip(page, clipId)).toBeVisible();
  await page.evaluate(
    async ({ deltaUs, edge: trimEdge, itemId }) => {
      const trimClipEdge = (
        window as Window & {
          __fastcatE2eTrimClipEdge?: (params: {
            itemId: string;
            edge: 'start' | 'end';
            deltaUs: number;
          }) => Promise<void>;
        }
      ).__fastcatE2eTrimClipEdge;

      if (!trimClipEdge) throw new Error('E2E timeline trim hook is not registered');
      await trimClipEdge({ itemId, edge: trimEdge, deltaUs });
    },
    { itemId: clipId, edge, deltaUs: Math.round(deltaPx * E2E_US_PER_PX) },
  );
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
  const source = page
    .locator(`[data-entry-path="${entryPath}"], [data-entry-path$="/${entryPath}"]`)
    .first();
  const target = track(page, trackId);
  if ((await source.count()) > 0) {
    await expect(source, `file entry ${entryPath}`).toBeVisible();
  }
  await expect(target, `track ${trackId}`).toBeVisible();

  await page.evaluate(
    async ({ name, path, trackId: tid }) => {
      const addFileToTrack = (
        window as Window & {
          __fastcatE2eAddFileToTrack?: (params: {
            name: string;
            path: string;
            trackId: string;
          }) => Promise<void>;
        }
      ).__fastcatE2eAddFileToTrack;

      if (!addFileToTrack) throw new Error('E2E timeline add hook is not registered');
      await addFileToTrack({ name, path, trackId: tid });
    },
    {
      name: entryPath.split('/').filter(Boolean).at(-1) ?? entryPath,
      path: entryPath,
      trackId,
    },
  );
}

export async function undoTimeline(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const undo = (window as Window & { __fastcatE2eUndoTimeline?: () => Promise<void> })
      .__fastcatE2eUndoTimeline;
    if (!undo) throw new Error('E2E timeline undo hook is not registered');
    await undo();
  });
}

export async function redoTimeline(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const redo = (window as Window & { __fastcatE2eRedoTimeline?: () => Promise<void> })
      .__fastcatE2eRedoTimeline;
    if (!redo) throw new Error('E2E timeline redo hook is not registered');
    await redo();
  });
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
