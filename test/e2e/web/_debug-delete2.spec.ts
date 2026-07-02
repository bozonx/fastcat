import { test, expect, waitForEditorReady } from '../fixtures/workspace';
import { MEDIA_FIXTURES } from '../../fixtures/media';
import { seedProjectMedia } from '../../utils/e2e/file-manager';
import { addFileToTrack, clipIds, trackIds, clip, timelineContainer } from '../../utils/e2e/timeline';
import { waitForTimelineDoc } from '../../utils/e2e/otio';

test.describe('Debug delete2', () => {
  test('debug fitTimelineZoom effect on clip', async ({ page, e2eProject }) => {
    const { uiPath } = await seedProjectMedia(
      page,
      e2eProject,
      MEDIA_FIXTURES.video.h264Mp4,
      'video',
    );
    const videoTrackId = (await trackIds(page))[0];
    await addFileToTrack(page, uiPath, videoTrackId!);
    await waitForTimelineDoc(page, e2eProject, (d) => d.allClips.length === 1);

    const clipId = (await clipIds(page))[0]!;
    console.log('clipId:', clipId);
    console.log('before fit - clip count:', await clip(page, clipId).count());
    console.log('before fit - clip visible:', await clip(page, clipId).isVisible().catch(() => false));

    // Replicate fitTimelineZoom
    await timelineContainer(page).click();
    await page.keyboard.press('Shift+0');
    await page.waitForTimeout(150);

    console.log('after fit - clip count:', await clip(page, clipId).count());
    console.log('after fit - clip visible:', await clip(page, clipId).isVisible().catch(() => false));
    console.log('after fit - all clipIds:', await clipIds(page));
    console.log('after fit - clip box:', await clip(page, clipId).boundingBox());

    // Wait a bit more
    await page.waitForTimeout(2000);
    console.log('after 2s - clip count:', await clip(page, clipId).count());
    console.log('after 2s - all clipIds:', await clipIds(page));
  });
});
