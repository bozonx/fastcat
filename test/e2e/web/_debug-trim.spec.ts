import { test, expect } from '../fixtures/workspace';
import { MEDIA_FIXTURES } from '../../fixtures/media';
import { seedProjectMedia } from '../../utils/e2e/file-manager';
import { addFileToTrack, clipIds, trackIds, clip } from '../../utils/e2e/timeline';
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
  const clipBox = await clipEl.boundingBox();
  console.log('clip box:', JSON.stringify(clipBox));

  const handle = clipEl.locator('[data-testid="clip-trim-end"]');
  const handleCount = await handle.count();
  console.log('trim handle count:', handleCount);
  if (handleCount > 0) {
    const handleBox = await handle.boundingBox();
    console.log('handle box:', JSON.stringify(handleBox));
  }

  // Try clicking the clip first
  await clipEl.click();
  await page.waitForTimeout(200);
  const handleCount2 = await handle.count();
  console.log('trim handle count after click:', handleCount2);
  if (handleCount2 > 0) {
    const handleBox2 = await handle.boundingBox();
    console.log('handle box after click:', JSON.stringify(handleBox2));
  }

  // Check if canEditClipContent is false (which would hide trim handles)
  const clipEl2 = clip(page, clipId);
  const html = await clipEl2.evaluate((el) => el.outerHTML.slice(0, 500));
  console.log('clip HTML (first 500 chars):', html);
});
