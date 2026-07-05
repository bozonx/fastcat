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
 * `selectClip` and shift-click multi-select drive real pointer clicks on those
 * clip roots. Move/trim/split/select-by-id/delete/add-to-track go through
 * test-only `__fastcatE2e*` hooks instead of pixel drags: real drags on clips
 * a few pixels wide (default zoom) are unreliable, and dragging small trim
 * handles doubly so (see `fitTimelineZoom`, added only as setup before pointer
 * gestures that do need real geometry, e.g. clip selection). Each hook calls
 * the same `applyTimeline`/command path a real drag would dispatch, and every
 * spec still asserts against the persisted OTIO document (see ./otio.ts)
 * rather than store internals — that's what keeps these e2e rather than unit
 * tests, not the input method.
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

async function waitForTimelineHook(page: Page, hookName: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          (name) => typeof (window as Window & Record<string, unknown>)[name] === 'function',
          hookName,
        ),
      { timeout: 10_000 },
    )
    .toBe(true);
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
  await waitForTimelineHook(page, '__fastcatE2eMoveClip');
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
  await waitForTimelineHook(page, '__fastcatE2eMoveClipToTrack');
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
  await waitForTimelineHook(page, '__fastcatE2eTrimClip');
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
 * Adds a project file to a timeline track through the app's real timeline
 * command path. DnD itself is covered elsewhere; timeline e2e specs use this
 * helper to create deterministic persisted state for history/reload/export
 * assertions.
 */
export async function addFileToTrack(
  page: Page,
  entryPath: string,
  trackId: string,
): Promise<void> {
  await waitForTimelineHook(page, '__fastcatE2eAddProjectFileToTrack');
  await page.evaluate(
    async ({ path, trackId: targetTrackId }) => {
      const fn = (
        window as Window & {
          __fastcatE2eAddProjectFileToTrack?: (params: {
            path: string;
            trackId: string;
          }) => Promise<void>;
        }
      ).__fastcatE2eAddProjectFileToTrack;
      if (!fn) throw new Error('E2E add project file hook is not registered');
      await fn({ path, trackId: targetTrackId });
    },
    { path: entryPath, trackId },
  );
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
  await waitForTimelineHook(page, '__fastcatE2eSetCurrentTimeUs');
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
  await waitForTimelineHook(page, '__fastcatE2eSplitClipAtPlayhead');
  await page.evaluate(async () => {
    const split = (window as Window & { __fastcatE2eSplitClipAtPlayhead?: () => Promise<void> })
      .__fastcatE2eSplitClipAtPlayhead;
    if (!split) throw new Error('E2E timeline split hook is not registered');
    await split();
  });
}

export async function selectTimelineClipsById(page: Page, itemIds: string[]): Promise<void> {
  await waitForTimelineHook(page, '__fastcatE2eSelectTimelineItems');
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
  await waitForTimelineHook(page, '__fastcatE2eGetSelectedItemIds');
  return page.evaluate(async () => {
    const getSelected = (
      window as Window & { __fastcatE2eGetSelectedItemIds?: () => Promise<string[]> }
    ).__fastcatE2eGetSelectedItemIds;
    if (!getSelected) throw new Error('E2E timeline get-selected hook is not registered');
    return getSelected();
  });
}

export async function deleteSelectedItems(page: Page): Promise<void> {
  await waitForTimelineHook(page, '__fastcatE2eDeleteSelectedItems');
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
  await waitForTimelineHook(page, '__fastcatE2eUpdateClipProperties');
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

export async function updateClipTransition(
  page: Page,
  params: {
    itemId: string;
    edge: 'in' | 'out';
    transition: {
      type: string;
      durationUs: number;
      mode: 'adjacent' | 'transparent' | 'background';
      curve: 'linear' | 'smooth' | 'ease-in' | 'ease-out';
      params?: Record<string, unknown>;
    } | null;
  },
): Promise<void> {
  await waitForTimelineHook(page, '__fastcatE2eUpdateClipTransition');
  await page.evaluate(async ({ itemId, edge, transition }) => {
    const update = (
      window as Window & {
        __fastcatE2eUpdateClipTransition?: (params: {
          itemId: string;
          edge: 'in' | 'out';
          transition: {
            type: string;
            durationUs: number;
            mode: 'adjacent' | 'transparent' | 'background';
            curve: 'linear' | 'smooth' | 'ease-in' | 'ease-out';
            params?: Record<string, unknown>;
          } | null;
        }) => Promise<void>;
      }
    ).__fastcatE2eUpdateClipTransition;
    if (!update) throw new Error('E2E timeline update-clip-transition hook is not registered');
    await update({ itemId, edge, transition });
  }, params);
}

export async function saveTimeline(page: Page): Promise<void> {
  await waitForTimelineHook(page, '__fastcatE2eSaveTimeline');
  await page.evaluate(async () => {
    const save = (window as Window & { __fastcatE2eSaveTimeline?: () => Promise<void> })
      .__fastcatE2eSaveTimeline;
    if (!save) throw new Error('E2E timeline save hook is not registered');
    await save();
  });
}

export async function setTimelineZoom(page: Page, zoom: number): Promise<void> {
  await waitForTimelineHook(page, '__fastcatE2eSetTimelineZoom');
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
  await waitForTimelineHook(page, '__fastcatE2eGetTimelineDocInfo');
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
  await setCurrentTimeUs(page, 0);
  await waitForTimelineHook(page, '__fastcatE2eAddTextClip');
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

export async function addMarker(
  page: Page,
  params: { timeUs: number; text?: string; color?: string; durationUs?: number },
): Promise<string> {
  await waitForTimelineHook(page, '__fastcatE2eAddMarker');
  const markerId = await page.evaluate(async (input) => {
    const add = (
      window as Window & {
        __fastcatE2eAddMarker?: (params: {
          timeUs: number;
          text?: string;
          color?: string;
          durationUs?: number;
        }) => Promise<string | null>;
      }
    ).__fastcatE2eAddMarker;
    if (!add) throw new Error('E2E timeline add-marker hook is not registered');
    return add(input);
  }, params);

  if (!markerId) throw new Error('E2E marker was not created');
  return markerId;
}

export async function addMarkers(
  page: Page,
  markers: Array<{ timeUs: number; text?: string; color?: string; durationUs?: number }>,
): Promise<string[]> {
  await waitForTimelineHook(page, '__fastcatE2eAddMarkers');
  return page.evaluate(async (input) => {
    const add = (
      window as Window & {
        __fastcatE2eAddMarkers?: (params: {
          markers: Array<{
            timeUs: number;
            text?: string;
            color?: string;
            durationUs?: number;
          }>;
        }) => Promise<string[]>;
      }
    ).__fastcatE2eAddMarkers;
    if (!add) throw new Error('E2E timeline add-markers hook is not registered');
    return add({ markers: input });
  }, markers);
}

export async function updateMarker(
  page: Page,
  params: {
    markerId: string;
    patch: { timeUs?: number; durationUs?: number | null; text?: string; color?: string };
  },
): Promise<void> {
  await waitForTimelineHook(page, '__fastcatE2eUpdateMarker');
  await page.evaluate(async (input) => {
    const update = (
      window as Window & {
        __fastcatE2eUpdateMarker?: (params: {
          markerId: string;
          patch: { timeUs?: number; durationUs?: number | null; text?: string; color?: string };
        }) => Promise<void>;
      }
    ).__fastcatE2eUpdateMarker;
    if (!update) throw new Error('E2E timeline update-marker hook is not registered');
    await update(input);
  }, params);
}

export async function removeMarker(page: Page, markerId: string): Promise<void> {
  await waitForTimelineHook(page, '__fastcatE2eRemoveMarker');
  await page.evaluate(async (id) => {
    const remove = (
      window as Window & {
        __fastcatE2eRemoveMarker?: (params: { markerId: string }) => Promise<void>;
      }
    ).__fastcatE2eRemoveMarker;
    if (!remove) throw new Error('E2E timeline remove-marker hook is not registered');
    await remove({ markerId: id });
  }, markerId);
}

export async function markerIds(page: Page): Promise<string[]> {
  await waitForTimelineHook(page, '__fastcatE2eGetMarkers');
  return page.evaluate(async () => {
    const getMarkers = (
      window as Window & {
        __fastcatE2eGetMarkers?: () => Promise<Array<{ id: string }>>;
      }
    ).__fastcatE2eGetMarkers;
    if (!getMarkers) throw new Error('E2E timeline get-markers hook is not registered');
    return (await getMarkers()).map((marker) => marker.id);
  });
}
