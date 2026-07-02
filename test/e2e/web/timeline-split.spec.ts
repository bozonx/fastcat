import { test, expect, waitForEditorReady } from '../fixtures/workspace';
import { MEDIA_FIXTURES } from '../../fixtures/media';
import { seedProjectMedia } from '../../utils/e2e/file-manager';
import {
  addFileToTrack,
  clipIds,
  selectClip,
  setCurrentTimeUs,
  splitClipAtPlayhead,
  trackIds,
} from '../../utils/e2e/timeline';
import { waitForTimelineDoc } from '../../utils/e2e/otio';

/**
 * Clip split (razor) at the playhead. The split is driven through the real
 * timeline command path so it records history and persists to the OTIO file.
 */
test.describe('Web timeline clip split', () => {
  test('splits a selected clip at the playhead and persists both parts', async ({
    page,
    e2eProject,
  }) => {
    const { uiPath } = await seedProjectMedia(
      page,
      e2eProject,
      MEDIA_FIXTURES.video.h264Mp4,
      'video',
    );
    const videoTrackId = (await trackIds(page))[0];
    await addFileToTrack(page, uiPath, videoTrackId);

    const before = await waitForTimelineDoc(page, e2eProject, (d) => d.allClips.length === 1);
    const originalDuration = before.allClips[0].timelineDurationUs;
    const cutUs = Math.round(originalDuration / 2);

    const clipId = (await clipIds(page))[0];
    await selectClip(page, clipId);
    await setCurrentTimeUs(page, cutUs);
    await splitClipAtPlayhead(page);

    const split = await waitForTimelineDoc(page, e2eProject, (d) => d.allClips.length === 2);
    expect(split.allClips).toHaveLength(2);
    const totalDuration = split.allClips.reduce((sum, c) => sum + c.timelineDurationUs, 0);
    expect(totalDuration).toBe(originalDuration);

    await expect.poll(async () => (await clipIds(page)).length).toBe(2);

    // Reload should preserve the two split parts.
    await page.goto(`/editor/${e2eProject.encodedName}`);
    await waitForEditorReady(page);
    await expect.poll(async () => (await clipIds(page)).length).toBe(2);
    const reloaded = await waitForTimelineDoc(page, e2eProject, (d) => d.allClips.length === 2);
    const reloadedTotal = reloaded.allClips.reduce((sum, c) => sum + c.timelineDurationUs, 0);
    expect(reloadedTotal).toBe(originalDuration);
  });
});
