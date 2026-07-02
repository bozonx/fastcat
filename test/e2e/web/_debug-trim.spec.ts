import { test, expect } from '../fixtures/workspace';
import { MEDIA_FIXTURES } from '../../fixtures/media';
import { seedProjectMedia } from '../../utils/e2e/file-manager';
import { addFileToTrack, clipIds, trackIds, clip, setTimelineZoom } from '../../utils/e2e/timeline';
import { waitForTimelineDoc } from '../../utils/e2e/otio';

test('_debug: trim clip bounding box', async ({ page, e2eProject }) => {
  const { uiPath } = await seedProjectMedia(
    page,
    e2eProject,
    MEDIA_FIXTURES.video.h264Mp4,
    'video',
  );
  const videoTrackId = (await trackIds(page))[0];
  await addFileToTrack(page, uiPath, videoTrackId);

  const doc0 = await waitForTimelineDoc(page, e2eProject, (d) => d.allClips.length === 1);
  const clipId = (await clipIds(page))[0];
  console.log('clipId:', clipId);
  console.log('doc0 duration:', doc0.allClips[0].timelineDurationUs);

  const clipEl = clip(page, clipId);
  await expect(clipEl).toBeVisible();
  const clipBox1 = await clipEl.boundingBox();
  console.log('clip box before zoom:', JSON.stringify(clipBox1));

  // Try setTimelineZoom
  await setTimelineZoom(page, 70);
  await page.waitForTimeout(300);

  const clipBox2 = await clipEl.boundingBox();
  console.log('clip box after zoom 70:', JSON.stringify(clipBox2));

  const handle = clipEl.locator('[data-testid="clip-trim-end"]');
  const handleBox = await handle.boundingBox();
  console.log('handle box after zoom 70:', JSON.stringify(handleBox));
});
