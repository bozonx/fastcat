import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures/workspace';
import type { E2eProject } from '../fixtures/workspace';
import { MEDIA_FIXTURES } from '../../fixtures/media';
import { seedProjectMedia } from '../../utils/e2e/file-manager';
import { addFileToTrack, clipIds, setTimelineZoom, trackIds } from '../../utils/e2e/timeline';
import { waitForTimelineDoc } from '../../utils/e2e/otio';

/**
 * Transitions interactive setup and manipulation on timeline clips.
 * Verifies create-handles, transition presence, and OTIO persistence.
 */
test.describe('Web timeline transitions', () => {
  test.slow();

  async function hoverClipAt(page: Page, clipLocator: Locator) {
    const box = await clipLocator.boundingBox();
    if (!box) {
      throw new Error('Clip has no bounding box');
    }

    await page.mouse.move(box.x + 5, box.y + 5, { steps: 4 });
  }

  async function clickCreateHandle(page: Page, handleLocator: Locator) {
    const box = await handleLocator.boundingBox();
    if (!box) {
      throw new Error('Transition handle has no bounding box');
    }

    const point = {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    };

    await handleLocator.evaluate((el, { x, y }) => {
      el.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          button: 0,
          buttons: 1,
          pointerId: 1,
          pointerType: 'mouse',
        }),
      );
    }, point);

    await page.evaluate(({ x, y }) => {
      window.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          button: 0,
          buttons: 0,
          pointerId: 1,
          pointerType: 'mouse',
        }),
      );
    }, point);
  }

  async function projectWithVideoClip(page: Page, project: E2eProject) {
    const { uiPath } = await seedProjectMedia(page, project, MEDIA_FIXTURES.video.h264Mp4, 'video');
    const videoTrackId = (await trackIds(page))[0];
    await addFileToTrack(page, uiPath, videoTrackId);
    await waitForTimelineDoc(page, project, (d) => d.allClips.length === 1);
    const clipId = (await clipIds(page))[0];
    await setTimelineZoom(page, 65);
    return clipId;
  }

  test('renders transition create handles on clip hover', async ({ page, e2eProject }) => {
    const clipId = await projectWithVideoClip(page, e2eProject);
    const clipLocator = page.locator(`[data-clip-id="${clipId}"]`);

    await hoverClipAt(page, clipLocator);

    const createHandleIn = clipLocator.locator('[data-testid="transition-create-in"]');
    const createHandleOut = clipLocator.locator('[data-testid="transition-create-out"]');

    await expect(createHandleIn).toHaveClass(/opacity-100/);
    await expect(createHandleOut).toHaveClass(/opacity-100/);
  });

  test('clicking transition create handle emits transition creation', async ({
    page,
    e2eProject,
  }) => {
    const clipId = await projectWithVideoClip(page, e2eProject);
    const clipLocator = page.locator(`[data-clip-id="${clipId}"]`);

    await hoverClipAt(page, clipLocator);

    const createHandleOut = clipLocator.locator('[data-testid="transition-create-out"]');
    await expect(createHandleOut).toHaveClass(/opacity-100/);
    await clickCreateHandle(page, createHandleOut);

    const doc = await waitForTimelineDoc(
      page,
      e2eProject,
      (timelineDoc) => timelineDoc.allClips[0]?.transitionOut?.type === 'dissolve',
    );
    expect(doc.allClips[0]?.transitionOut).toMatchObject({
      type: 'dissolve',
    });
  });
});
