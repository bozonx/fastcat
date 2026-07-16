import { test, expect, waitForEditorReady } from '../fixtures/workspace';
import { MEDIA_FIXTURES } from '../../fixtures/media';
import { seedProjectMedia } from '../../utils/e2e/file-manager';
import {
  addFileToTrack,
  clipIds,
  dragClipBy,
  trackIds,
  trimClipEdge,
} from '../../utils/e2e/timeline';
import { waitForTimelineDoc } from '../../utils/e2e/otio';
import { expectPlayheadAdvances } from '../../utils/e2e/transport';

/**
 * The single long happy-path. Its job is to prove the main editor workflow stays
 * wired together; detailed assertions live in the focused specs. Do not grow
 * more long workflows here unless they cover a genuinely different critical path.
 */
test.describe('Web editor smoke workflow', () => {
  test.slow();

  test('import → add → play → trim → move → reload persists', async ({ page, e2eProject }) => {
    // Import (via fast seed) and add to the timeline.
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
    const baseDuration = doc0.allClips[0].timelineDurationTicks;

    // Play briefly, then it auto-pauses inside the helper.
    await expectPlayheadAdvances(page, { forMs: 500 });

    // Trim one edge shorter (in microseconds).
    await trimClipEdge(page, clipId, 'end', -200_000);
    await waitForTimelineDoc(
      page,
      e2eProject,
      (d) => d.allClips[0].timelineDurationTicks < baseDuration,
    );

    // Move it later on the same track (in microseconds).
    await dragClipBy(page, clipId, { x: 1_000_000 });
    const edited = await waitForTimelineDoc(
      page,
      e2eProject,
      (d) => d.allClips[0].timelineStartTicks > 0,
    );

    // Reload and confirm the edited clip persisted with its edited timing.
    await page.goto(`/editor/${e2eProject.encodedName}`);
    await waitForEditorReady(page);
    await expect.poll(async () => (await clipIds(page)).length).toBe(1);

    const reloaded = await waitForTimelineDoc(page, e2eProject, (d) => d.allClips.length === 1);
    expect(reloaded.allClips[0].timelineDurationTicks).toBe(
      edited.allClips[0].timelineDurationTicks,
    );
    expect(reloaded.allClips[0].timelineStartTicks).toBe(edited.allClips[0].timelineStartTicks);
  });
});
