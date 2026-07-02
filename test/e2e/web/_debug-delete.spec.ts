import { test, expect, waitForEditorReady } from '../fixtures/workspace';
import { MEDIA_FIXTURES } from '../../fixtures/media';
import { seedProjectMedia } from '../../utils/e2e/file-manager';
import { addFileToTrack, clipIds, deleteClip, trackIds, clip, track } from '../../utils/e2e/timeline';
import { waitForTimelineDoc } from '../../utils/e2e/otio';

test.describe('Debug delete', () => {
  test('deletes a timeline clip and persists the empty timeline', async ({ page, e2eProject }) => {
    const { uiPath } = await seedProjectMedia(
      page,
      e2eProject,
      MEDIA_FIXTURES.video.h264Mp4,
      'video',
    );
    const videoTrackId = (await trackIds(page))[0];
    await addFileToTrack(page, uiPath, videoTrackId!);
    await waitForTimelineDoc(page, e2eProject, (d) => d.allClips.length === 1);

    const clipId = (await clipIds(page))[0];
    console.log('clipId before delete:', clipId);
    console.log('all clipIds:', await clipIds(page));
    console.log('clip element count:', await clip(page, clipId).count());
    console.log('clip element visible:', await clip(page, clipId).isVisible().catch(() => false));
    
    const clipBox = await clip(page, clipId).boundingBox();
    console.log('clip boundingBox:', clipBox);

    await deleteClip(page, clipId!);

    await expect.poll(async () => (await clipIds(page)).length).toBe(0);
    await waitForTimelineDoc(page, e2eProject, (d) => d.allClips.length === 0);

    await page.goto(`/editor/${e2eProject.encodedName}`);
    await waitForEditorReady(page);
    await expect.poll(async () => (await clipIds(page)).length).toBe(0);
  });
});
