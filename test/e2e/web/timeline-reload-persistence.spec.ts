import { test, expect, waitForEditorReady } from '../fixtures/workspace';
import { MEDIA_FIXTURES } from '../../fixtures/media';
import { seedProjectMedia, navigateToFolder } from '../../utils/e2e/file-manager';
import {
  addFileToTrack,
  clipIds,
  dragClipBy,
  trackIds,
  trimClipEdge,
} from '../../utils/e2e/timeline';
import { waitForTimelineDoc } from '../../utils/e2e/otio';

/**
 * Persistence / reload with a complex timeline containing multiple media kinds
 * across different tracks plus edits (trim and move). After reload the saved
 * OTIO structure is expected to match exactly.
 */
test.describe('Web timeline reload persistence', () => {
  test('reload preserves a multi-track edited timeline', async ({ page, e2eProject }) => {
    const video = await seedProjectMedia(page, e2eProject, MEDIA_FIXTURES.video.h264Mp4, 'video');
    const audio = await seedProjectMedia(page, e2eProject, MEDIA_FIXTURES.audio.wav, 'audio');
    const image = await seedProjectMedia(page, e2eProject, MEDIA_FIXTURES.image.jpg, 'image');

    const trackIdsList = await trackIds(page);
    await navigateToFolder(page, '_video');
    await expect(page.locator(`[data-entry-path="${video.uiPath}"]`)).toBeVisible({ timeout: 5_000 });
    await addFileToTrack(page, video.uiPath, trackIdsList[0]);
    await navigateToFolder(page, '_images');
    await expect(page.locator(`[data-entry-path="${image.uiPath}"]`)).toBeVisible({ timeout: 5_000 });
    await addFileToTrack(page, image.uiPath, trackIdsList[1]);
    await navigateToFolder(page, '_audio');
    await expect(page.locator(`[data-entry-path="${audio.uiPath}"]`)).toBeVisible({ timeout: 5_000 });
    await addFileToTrack(page, audio.uiPath, trackIdsList.at(-1)!);
    await waitForTimelineDoc(page, e2eProject, (d) => d.allClips.length === 3);

    const ids = await clipIds(page);
    expect(ids.length).toBe(3);

    // Trim the first clip (video) and move the second (image) later.
    await trimClipEdge(page, ids[0], 'end', -400_000);
    await dragClipBy(page, ids[1], { x: 800_000 });

    const edited = await waitForTimelineDoc(page, e2eProject, (d) => d.allClips.length === 3);
    const editedVideoDuration = edited.allClips[0].timelineDurationUs;
    const editedImageStart = edited.allClips[1].timelineStartUs;

    // Reload the editor and verify the same structure is restored.
    await page.goto(`/editor/${e2eProject.encodedName}`);
    await waitForEditorReady(page);
    await expect.poll(async () => (await clipIds(page)).length).toBe(3);

    const reloaded = await waitForTimelineDoc(page, e2eProject, (d) => d.allClips.length === 3);
    expect(reloaded.allClips[0].timelineDurationUs).toBe(editedVideoDuration);
    expect(reloaded.allClips[1].timelineStartUs).toBe(editedImageStart);
    expect(reloaded.videoTracks.length).toBeGreaterThanOrEqual(1);
    expect(reloaded.audioTracks.length).toBeGreaterThanOrEqual(1);
  });
});
