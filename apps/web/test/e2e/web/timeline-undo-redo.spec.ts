import { test, expect, waitForEditorReady } from '../fixtures/workspace';
import { MEDIA_FIXTURES } from '../../fixtures/media';
import { seedProjectMedia } from '../../utils/e2e/file-manager';
import {
  addFileToTrack,
  clipIds,
  deleteClip,
  redoTimeline,
  trackIds,
  undoTimeline,
} from '../../utils/e2e/timeline';
import { waitForTimelineDoc } from '../../utils/e2e/otio';

/**
 * Undo/redo history for timeline edits. Tests exercise the real history store
 * through user-level actions (delete clip) and verify persisted document state.
 */
test.describe('Web timeline undo / redo', () => {
  test('undo restores a deleted clip and redo removes it again', async ({ page, e2eProject }) => {
    const { uiPath } = await seedProjectMedia(
      page,
      e2eProject,
      MEDIA_FIXTURES.video.h264Mp4,
      'video',
    );
    const videoTrackId = (await trackIds(page))[0];
    await addFileToTrack(page, uiPath, videoTrackId);

    const before = await waitForTimelineDoc(page, e2eProject, (d) => d.allClips.length === 1);
    const originalDuration = before.allClips[0].timelineDurationTicks;

    const clipId = (await clipIds(page))[0];
    await deleteClip(page, clipId);
    await waitForTimelineDoc(page, e2eProject, (d) => d.allClips.length === 0);
    await expect.poll(async () => (await clipIds(page)).length).toBe(0);

    await undoTimeline(page);
    const undone = await waitForTimelineDoc(page, e2eProject, (d) => d.allClips.length === 1);
    expect(undone.allClips[0].timelineDurationTicks).toBe(originalDuration);
    await expect.poll(async () => (await clipIds(page)).length).toBe(1);

    await redoTimeline(page);
    await waitForTimelineDoc(page, e2eProject, (d) => d.allClips.length === 0);
    await expect.poll(async () => (await clipIds(page)).length).toBe(0);

    // Reload should preserve the redone (empty) state.
    await page.goto(`/editor/${e2eProject.encodedName}`);
    await waitForEditorReady(page);
    await expect.poll(async () => (await clipIds(page)).length).toBe(0);
  });
});
