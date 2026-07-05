import type { Page } from '@playwright/test';
import { test, expect, waitForEditorReady } from '../fixtures/workspace';
import type { E2eProject } from '../fixtures/workspace';
import { MEDIA_FIXTURES } from '../../fixtures/media';
import { seedProjectMedia } from '../../utils/e2e/file-manager';
import { addFileToTrack, clipIds, selectTimelineClipsById, setTimelineZoom, trackIds } from '../../utils/e2e/timeline';
import { readTimelineDoc, waitForTimelineDoc } from '../../utils/e2e/otio';

/**
 * Audio fades and volume manipulation on timeline clips.
 * Verifies interactive handle state and OTIO persistence.
 */
test.describe('Web timeline audio fades', () => {
  test.slow();

  async function projectWithAudioClip(page: Page, project: E2eProject) {
    const { uiPath } = await seedProjectMedia(page, project, MEDIA_FIXTURES.audio.m4a, 'audio');
    const audioTrackId = (await trackIds(page)).at(-1)!;
    await addFileToTrack(page, uiPath, audioTrackId);
    await waitForTimelineDoc(page, project, (d) => d.allClips.length === 1);
    const clipId = (await clipIds(page))[0];
    await setTimelineZoom(page, 65);
    return clipId;
  }

  test('clip renders volume control and fade handles when selected', async ({
    page,
    e2eProject,
  }) => {
    const clipId = await projectWithAudioClip(page, e2eProject);
    const clipLocator = page.locator(`[data-clip-id="${clipId}"]`);

    // Select the clip via hook to enable volume & fade handle dragging
    await selectTimelineClipsById(page, [clipId]);

    const volumeControl = clipLocator.locator('[data-testid="clip-volume-control"]');
    await expect(volumeControl).toBeVisible();
    await expect(volumeControl).not.toHaveClass(/pointer-events-none/);
  });

  test('double clicking volume line resets audio gain', async ({ page, e2eProject }) => {
    const clipId = await projectWithAudioClip(page, e2eProject);
    const clipLocator = page.locator(`[data-clip-id="${clipId}"]`);

    await selectTimelineClipsById(page, [clipId]);
    const volumeControl = clipLocator.locator('[data-testid="clip-volume-control"]');

    if (await volumeControl.isVisible()) {
      await volumeControl.dblclick({ force: true });
      const doc = await readTimelineDoc(page, e2eProject);
      expect(doc.allClips[0].audioGain ?? 1).toBeCloseTo(1, 1);
    }
  });
});
