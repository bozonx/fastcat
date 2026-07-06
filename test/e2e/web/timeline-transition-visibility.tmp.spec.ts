import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/workspace';
import type { E2eProject } from '../fixtures/workspace';
import { MEDIA_FIXTURES } from '../../fixtures/media';
import { seedProjectMedia } from '../../utils/e2e/file-manager';
import {
  addFileToTrack,
  clipIds,
  setTimelineZoom,
  trackIds,
} from '../../utils/e2e/timeline';
import { waitForTimelineDoc } from '../../utils/e2e/otio';

test.describe('Transition visibility on clip (tmp repro)', () => {
  test.slow();

  async function projectWithVideoClip(page: Page, project: E2eProject) {
    const { uiPath } = await seedProjectMedia(page, project, MEDIA_FIXTURES.video.h264Mp4, 'video');
    const videoTrackId = (await trackIds(page))[0];
    await addFileToTrack(page, uiPath, videoTrackId);
    await waitForTimelineDoc(page, project, (d) => d.allClips.length === 1);
    const clipId = (await clipIds(page))[0];
    await setTimelineZoom(page, 65);
    return clipId;
  }

  test('clicking the create-out triangle creates a visible transition', async ({
    page,
    e2eProject,
  }) => {
    page.on('pageerror', (err) => console.log('PAGEERROR:', err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning')
        console.log(`CONSOLE[${msg.type()}]:`, msg.text().slice(0, 300));
    });
    const clipId = await projectWithVideoClip(page, e2eProject);
    const clipLocator = page.locator(`[data-clip-id="${clipId}"]`);

    const box = await clipLocator.boundingBox();
    if (!box) throw new Error('no clip box');
    await page.mouse.move(box.x + 5, box.y + 5, { steps: 4 });

    const handle = clipLocator.locator('[data-testid="transition-create-out"]');
    await expect(handle).toHaveClass(/cursor-pointer/);
    const hbox = await handle.boundingBox();
    if (!hbox) throw new Error('no handle box');
    console.log('clip box:', JSON.stringify(box), 'handle box:', JSON.stringify(hbox));

    // Raw click (no drag) via mouse events — the handle is tiny and offset
    // below the clip, so Playwright's actionability click refuses it.
    const cx = hbox.x + hbox.width / 2;
    const cy = hbox.y + 2; // top of triangle: inside viewport and inside the trim-handle overlap zone
    const under = await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x!, y!);
        const chain: string[] = [];
        let cur: Element | null = el;
        for (let i = 0; cur && i < 5; i++) {
          chain.push(
            `${cur.tagName}${cur.getAttribute('data-testid') ? `[${cur.getAttribute('data-testid')}]` : ''}.${(cur.getAttribute('class') ?? '').slice(0, 80)}`,
          );
          cur = cur.parentElement;
        }
        return chain;
      },
      [cx, cy],
    );
    console.log('element under click point:', JSON.stringify(under, null, 1));
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.up();
    // Inspect the in-memory pinia doc directly.
    await page.waitForTimeout(1000);
    const memClip = await page.evaluate(() => {
      const pinia = (globalThis as any).__NUXT_TEST_PINIA__ ?? (globalThis as any).$pinia;
      try {
        const nuxt = (globalThis as any).useNuxtApp?.();
        const p = nuxt?.$pinia ?? pinia;
        const store = p?._s?.get('timeline');
        const doc = store?.timelineDoc;
        const clip = doc?.tracks?.flatMap((t: any) => t.items).find((i: any) => i.kind === 'clip');
        return clip
          ? { transitionIn: clip.transitionIn ?? null, transitionOut: clip.transitionOut ?? null }
          : 'no clip';
      } catch (e) {
        return 'err: ' + String(e);
      }
    });
    console.log('in-memory clip transitions:', JSON.stringify(memClip));

    // The wedge must appear on the clip immediately (in-memory doc).
    const wedge = clipLocator.locator('button[class*="group/trans"]');
    await expect(wedge).toHaveCount(1, { timeout: 5000 });
    const wbox = await wedge.boundingBox();
    console.log('click-created wedge box:', JSON.stringify(wbox));
    expect(wbox?.width ?? 0).toBeGreaterThan(1);

    const doc = await waitForTimelineDoc(page, e2eProject, (d) =>
      Boolean(d.allClips[0]?.transitionOut),
    );
    console.log('transitionOut after click:', JSON.stringify(doc.allClips[0]?.transitionOut));
  });

  test('drag-creating via the triangle leaves a visible transition', async ({
    page,
    e2eProject,
  }) => {
    const clipId = await projectWithVideoClip(page, e2eProject);
    const clipLocator = page.locator(`[data-clip-id="${clipId}"]`);

    const box = await clipLocator.boundingBox();
    if (!box) throw new Error('no clip box');
    await page.mouse.move(box.x + 5, box.y + 5, { steps: 4 });

    const handle = clipLocator.locator('[data-testid="transition-create-out"]');
    const hbox = await handle.boundingBox();
    if (!hbox) throw new Error('no handle box');

    const startX = hbox.x + hbox.width / 2;
    const startY = hbox.y + 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 60, startY, { steps: 10 });
    // Wedge should be visible mid-drag.
    const wedge = clipLocator.locator('button[class*="group/trans"]');
    const midDragCount = await wedge.count();
    console.log('wedge count mid-drag:', midDragCount);
    await page.mouse.up();

    // And must remain after release.
    await expect(wedge).toHaveCount(1, { timeout: 5000 });
    const wbox = await wedge.boundingBox();
    console.log('drag-created wedge box:', JSON.stringify(wbox));
    expect(wbox?.width ?? 0).toBeGreaterThan(1);

    const doc = await waitForTimelineDoc(page, e2eProject, (d) =>
      Boolean(d.allClips[0]?.transitionOut),
    );
    console.log('transitionOut after drag:', JSON.stringify(doc.allClips[0]?.transitionOut));
    expect(doc.allClips[0]?.transitionOut?.durationUs ?? 0).toBeGreaterThan(0);
  });
});
