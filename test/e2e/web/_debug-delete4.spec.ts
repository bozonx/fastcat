import { test, expect } from '../fixtures/workspace';
import { MEDIA_FIXTURES } from '../../fixtures/media';
import { seedProjectMedia } from '../../utils/e2e/file-manager';
import { addFileToTrack, clipIds, trackIds, clip, timelineContainer } from '../../utils/e2e/timeline';
import { waitForTimelineDoc } from '../../utils/e2e/otio';

test.describe('Debug delete4', () => {
  test('isolate click vs shift+0', async ({ page, e2eProject }) => {
    const { uiPath } = await seedProjectMedia(page, e2eProject, MEDIA_FIXTURES.video.h264Mp4, 'video');
    const videoTrackId = (await trackIds(page))[0];
    await addFileToTrack(page, uiPath, videoTrackId!);
    await waitForTimelineDoc(page, e2eProject, (d) => d.allClips.length === 1);

    const clipId = (await clipIds(page))[0]!;
    console.log('clipId:', clipId);
    console.log('initial clip count:', await clip(page, clipId).count());

    // Step 1: just click the timeline container
    await timelineContainer(page).click();
    await page.waitForTimeout(200);
    console.log('after click - clip count:', await clip(page, clipId).count());
    console.log('after click - all clipIds:', await clipIds(page));

    // Step 2: press Shift+0
    await page.keyboard.press('Shift+0');
    await page.waitForTimeout(200);
    console.log('after Shift+0 - clip count:', await clip(page, clipId).count());
    console.log('after Shift+0 - all clipIds:', await clipIds(page));
  });
});
