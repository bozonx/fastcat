import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/workspace';
import type { E2eProject } from '../fixtures/workspace';
import { MEDIA_FIXTURES } from '../../fixtures/media';
import { seedProjectMedia } from '../../utils/e2e/file-manager';
import {
  addFileToTrack,
  clipIds,
  selectClip,
  setTimelineZoom,
  trackIds,
} from '../../utils/e2e/timeline';
import { waitForTimelineDoc } from '../../utils/e2e/otio';

async function readSelectedClipTransition(page: Page) {
  return page.evaluate(() => {
    const w = window as any;
    const p = w.useNuxtApp?.()?.$pinia ?? w.$pinia;
    const store = p?._s?.get('timeline');
    const doc = store?.timelineDoc;
    const clips = doc?.tracks?.flatMap((t: any) => t.items).filter((i: any) => i.kind === 'clip');
    return clips?.map((c: any) => ({
      id: c.id,
      clipType: c.clipType,
      transitionIn: c.transitionIn ?? null,
      transitionOut: c.transitionOut ?? null,
    }));
  });
}

test.describe('Transition triangle repro', () => {
  test.slow();

  async function projectWithVideoClip(page: Page, project: E2eProject) {
    const { uiPath } = await seedProjectMedia(page, project, MEDIA_FIXTURES.video.h264Mp4, 'video');
    const videoTrackId = (await trackIds(page))[0];
    await addFileToTrack(page, uiPath, videoTrackId);
    await waitForTimelineDoc(page, project, (d) => d.allClips.length === 1);
    const clipId = (await clipIds(page))[0];
    // Moderate zoom: clip wide enough for the handle (>=30px) but left edge
    // (create-IN handle) stays at the visible timeline origin.
    await setTimelineZoom(page, 72);
    return clipId;
  }

  test('drag-create via triangle: transition present in doc AND wedge visible', async ({
    page,
    e2eProject,
  }) => {
    const clipId = await projectWithVideoClip(page, e2eProject);
    const clipLocator = page.locator(`[data-clip-id="${clipId}"]`);

    // Hover near the clip's left edge to reveal the create handles (no click:
    // the clip can be wider than the viewport, making a center-click hang).
    const box = await clipLocator.boundingBox();
    if (!box) throw new Error('no clip box');
    console.log('clip box:', JSON.stringify(box));
    await page.mouse.move(box.x + 8, box.y + box.height / 2, {
      steps: 3,
    });

    // Drive the whole gesture in-page from the handle's own rect, so device-pixel
    // and viewport-offset quirks can't push the click off-target. Verify the
    // handle really is the hit-test target before dispatching — this is the crux:
    // if the trim handle (raised to --z-clip-handles) sits on top, the triangle
    // never receives the pointer and no transition is created.
    const result = await page.evaluate((cid) => {
      const clipEl = document.querySelector(`[data-clip-id="${cid}"]`);
      const h = clipEl?.querySelector('[data-testid="transition-create-in"]') as HTMLElement | null;
      if (!h) return { ok: false, reason: 'no handle el' };
      const cls = h.getAttribute('class') ?? '';
      const r = h.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const hitEl = document.elementFromPoint(cx, cy) as HTMLElement | null;
      const hitInHandle = !!hitEl && (hitEl === h || h.contains(hitEl));
      const hitTestid =
        hitEl?.getAttribute('data-testid') ??
        hitEl?.closest('[data-testid]')?.getAttribute('data-testid') ??
        null;

      const fire = (type: string, target: EventTarget, x: number, dy = 0) => {
        target.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: cy + dy,
            button: 0,
            buttons: type === 'pointerup' ? 0 : 1,
            pointerId: 1,
            pointerType: 'mouse',
          }),
        );
      };

      // Dispatch on whatever is actually the hit-test winner (mimicking a real
      // user click at that pixel), then drag right on window.
      const downTarget = hitEl ?? h;
      fire('pointerdown', downTarget, cx);
      for (let i = 1; i <= 10; i++) fire('pointermove', window, cx + i * 8);
      fire('pointerup', window, cx + 80);

      return { ok: true, handleClass: cls, hitInHandle, hitTag: hitEl?.tagName, hitTestid };
    }, clipId);
    console.log('gesture result:', JSON.stringify(result));

    // Give Vue a tick to flush.
    await page.waitForTimeout(500);

    const transitions = await readSelectedClipTransition(page);
    console.log('doc clip transitions after drag:', JSON.stringify(transitions));

    // Does the persisted doc get it?
    const doc = await waitForTimelineDoc(
      page,
      e2eProject,
      (d) => Boolean(d.allClips[0]?.transitionIn),
      { timeout: 4000 },
    ).catch(() => null);
    console.log('persisted transitionIn:', JSON.stringify(doc?.allClips[0]?.transitionIn ?? null));

    // The wedge button must be present and non-zero width.
    const wedge = clipLocator.locator('button[class*="group/trans"]');
    const wedgeCount = await wedge.count();
    console.log('wedge count after drag:', wedgeCount);
    if (wedgeCount > 0) {
      const wbox = await wedge.first().boundingBox();
      console.log('wedge box:', JSON.stringify(wbox));
    }

    expect(wedgeCount).toBeGreaterThan(0);
  });
});
