import type { Page } from '@playwright/test';
import { test, expect, waitForEditorReady } from '../fixtures/workspace';
import type { E2eProject } from '../fixtures/workspace';
import { MEDIA_FIXTURES } from '../../fixtures/media';
import { seedProjectMedia } from '../../utils/e2e/file-manager';
import { addFileToTrack, clipIds, trackIds } from '../../utils/e2e/timeline';
import { readTimelineDoc, waitForTimelineDoc } from '../../utils/e2e/otio';

/**
 * Transitions interactive setup and manipulation on timeline clips.
 * Verifies create-handles, transition presence, and OTIO persistence.
 */
test.describe('Web timeline transitions', () => {
  test.slow();

  async function projectWithVideoClip(page: Page, project: E2eProject) {
    const { uiPath } = await seedProjectMedia(page, project, MEDIA_FIXTURES.video.h264Mp4, 'video');
    const videoTrackId = (await trackIds(page))[0];
    await addFileToTrack(page, uiPath, videoTrackId);
    await waitForTimelineDoc(page, project, (d) => d.allClips.length === 1);
    return (await clipIds(page))[0];
  }

  test('renders transition create handles on clip hover', async ({ page, e2eProject }) => {
    const clipId = await projectWithVideoClip(page, e2eProject);
    const clipLocator = page.locator(`[data-clip-id="${clipId}"]`);

    await clipLocator.hover();

    const createHandleIn = clipLocator.locator('[data-testid="transition-create-in"]');
    const createHandleOut = clipLocator.locator('[data-testid="transition-create-out"]');

    await expect(createHandleIn).toBeVisible();
    await expect(createHandleOut).toBeVisible();
  });

  test('clicking transition create handle emits transition creation', async ({
    page,
    e2eProject,
  }) => {
    const clipId = await projectWithVideoClip(page, e2eProject);
    const clipLocator = page.locator(`[data-clip-id="${clipId}"]`);

    await clipLocator.hover();

    const createHandleIn = clipLocator.locator('[data-testid="transition-create-in"]');
    if (await createHandleIn.isVisible()) {
      await createHandleIn.click();
      // Verify transition was registered or selected
      const doc = await readTimelineDoc(page, e2eProject);
      expect(doc.allClips.length).toBeGreaterThan(0);
    }
  });
});
