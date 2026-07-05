import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures/workspace';
import type { E2eProject } from '../fixtures/workspace';
import { MEDIA_FIXTURES } from '../../fixtures/media';
import { seedProjectMedia } from '../../utils/e2e/file-manager';
import { addFileToTrack, clipIds, setTimelineZoom, trackIds } from '../../utils/e2e/timeline';
import { readTimelineDoc, waitForTimelineDoc } from '../../utils/e2e/otio';

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

  async function clickVisibleHandleArea(page: Page, handleLocator: Locator) {
    const box = await handleLocator.boundingBox();
    const viewport = page.viewportSize();
    if (!box || !viewport) {
      throw new Error('Transition handle has no clickable viewport area');
    }

    const left = Math.max(1, box.x + 1);
    const right = Math.min(viewport.width - 1, box.x + box.width - 1);
    const top = Math.max(1, box.y + 1);
    const bottom = Math.min(viewport.height - 1, box.y + box.height - 1);

    if (left > right || top > bottom) {
      throw new Error('Transition handle is outside of the viewport');
    }

    const x = left + (right - left) / 2;
    const y = top + (bottom - top) / 2;

    await page.mouse.move(x, y, { steps: 2 });
    await page.mouse.click(x, y);
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
    await clickVisibleHandleArea(page, createHandleOut);

    const doc = await readTimelineDoc(page, e2eProject);
    expect(doc.allClips[0]?.transitionOut).toMatchObject({
      type: 'dissolve',
    });
  });
});
