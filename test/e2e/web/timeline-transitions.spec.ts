import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures/workspace';
import type { E2eProject } from '../fixtures/workspace';
import { MEDIA_FIXTURES } from '../../fixtures/media';
import { seedProjectMedia } from '../../utils/e2e/file-manager';
import {
  addFileToTrack,
  clipIds,
  setTimelineZoom,
  trackIds,
  updateClipTransition,
} from '../../utils/e2e/timeline';
import { waitForTimelineDoc } from '../../utils/e2e/otio';

/**
 * Transitions interactive setup and manipulation on timeline clips.
 * Verifies header creation buttons, transition presence, and OTIO persistence.
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

  async function projectWithVideoClip(page: Page, project: E2eProject) {
    const { uiPath } = await seedProjectMedia(page, project, MEDIA_FIXTURES.video.h264Mp4, 'video');
    const videoTrackId = (await trackIds(page))[0];
    await addFileToTrack(page, uiPath, videoTrackId);
    await waitForTimelineDoc(page, project, (d) => d.allClips.length === 1);
    const clipId = (await clipIds(page))[0];
    await setTimelineZoom(page, 65);
    return clipId;
  }

  test('creates a transition from the clip header button', async ({ page, e2eProject }) => {
    const clipId = await projectWithVideoClip(page, e2eProject);
    const clipLocator = page.locator(`[data-clip-id="${clipId}"]`);

    await hoverClipAt(page, clipLocator);

    const createButtonIn = clipLocator.getByTestId('clip-add-transition-in');
    const createButtonOut = clipLocator.getByTestId('clip-add-transition-out');

    await expect(createButtonIn).toBeVisible();
    await expect(createButtonOut).toBeVisible();
    await expect(clipLocator.locator('[data-testid^="transition-create-"]')).toHaveCount(0);

    await createButtonOut.click();

    const doc = await waitForTimelineDoc(
      page,
      e2eProject,
      (timelineDoc) => timelineDoc.allClips[0]?.transitionOut?.type === 'dissolve',
    );
    expect(doc.allClips[0]?.transitionOut).toMatchObject({
      type: 'dissolve',
    });
    await expect(clipLocator.getByTestId('transition-out')).toBeVisible();
    await expect(createButtonOut).toHaveCount(0);
  });

  test('creates transition through timeline command path', async ({ page, e2eProject }) => {
    const clipId = await projectWithVideoClip(page, e2eProject);

    await updateClipTransition(page, {
      itemId: clipId,
      edge: 'out',
      transition: {
        type: 'dissolve',
        durationUs: 300_000,
        mode: 'adjacent',
        curve: 'linear',
      },
    });

    const doc = await waitForTimelineDoc(
      page,
      e2eProject,
      (timelineDoc) => timelineDoc.allClips[0]?.transitionOut?.type === 'dissolve',
    );
    expect(doc.allClips[0]?.transitionOut).toMatchObject({
      type: 'dissolve',
    });

    const clipLocator = page.locator(`[data-clip-id="${clipId}"]`);
    const transitionOut = clipLocator.getByTestId('transition-out');
    await expect(transitionOut).toBeVisible();
    await expect
      .poll(async () => {
        const box = await transitionOut.boundingBox();
        return Boolean(box && box.width > 0 && box.height > 0);
      })
      .toBe(true);
  });
});
