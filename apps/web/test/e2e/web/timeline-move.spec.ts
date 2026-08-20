import { test, expect, waitForEditorReady } from '../fixtures/workspace';
import type { Page } from '@playwright/test';
import type { E2eProject } from '../fixtures/workspace';
import { MEDIA_FIXTURES } from '../../fixtures/media';
import { seedProjectMedia } from '../../utils/e2e/file-manager';
import {
  addFileToTrack,
  clipIds,
  dragClipBy,
  moveClipToTrack,
  trackIds,
} from '../../utils/e2e/timeline';
import { readTimelineDoc, waitForTimelineDoc } from '../../utils/e2e/otio';
import { secondsToTicks } from '~/utils/time';

// Deltas must be whole-frame tick magnitudes (TICKS_PER_SECOND = 254_016_000_000);
// the old microsecond-scale literals quantized to a no-op under the new timebase.
const MOVE_LATER_TICKS = secondsToTicks({ seconds: 1.2 });

/**
 * Repositioning clips on the timeline. Verifies both DOM placement and persisted
 * OTIO timing/track membership. Transitions/grouping/ripple are out of scope.
 */
test.describe('Web timeline move', () => {
  test.slow();

  async function projectWithOneVideoClip(page: Page, project: E2eProject) {
    const { uiPath } = await seedProjectMedia(page, project, MEDIA_FIXTURES.video.h264Mp4, 'video');
    const videoTrackId = (await trackIds(page))[0];
    await addFileToTrack(page, uiPath, videoTrackId);
    await waitForTimelineDoc(page, project, (d) => d.allClips.length === 1);
    return (await clipIds(page))[0];
  }

  test('moving a clip later increases its timeline start', async ({ page, e2eProject }) => {
    const clipId = await projectWithOneVideoClip(page, e2eProject);
    const before = (await readTimelineDoc(page, e2eProject)).allClips[0];

    await dragClipBy(page, clipId, { x: MOVE_LATER_TICKS });

    // A later start manifests as a leading gap in the sequential OTIO track.
    const doc = await waitForTimelineDoc(
      page,
      e2eProject,
      (d) => (d.allClips[0]?.timelineStartTicks ?? 0) > before.timelineStartTicks,
    );
    expect(doc.allClips[0].timelineStartTicks).toBeGreaterThan(before.timelineStartTicks);
  });

  test('moved clip persists across reload', async ({ page, e2eProject }) => {
    const clipId = await projectWithOneVideoClip(page, e2eProject);
    await dragClipBy(page, clipId, { x: MOVE_LATER_TICKS });
    const moved = (
      await waitForTimelineDoc(page, e2eProject, (d) => d.allClips[0].timelineStartTicks > 0)
    ).allClips[0].timelineStartTicks;

    await page.goto(`/editor/${e2eProject.encodedName}`);
    await waitForEditorReady(page);

    const reloaded = (await readTimelineDoc(page, e2eProject)).allClips[0].timelineStartTicks;
    expect(reloaded).toBe(moved);
  });

  test('moves a clip between video tracks and persists track membership', async ({
    page,
    e2eProject,
  }) => {
    const clipId = await projectWithOneVideoClip(page, e2eProject);
    const before = await readTimelineDoc(page, e2eProject);
    const fromTrack = before.videoTracks.find((t) => t.clips.some((c) => c.name));
    const toTrack = before.videoTracks.find((t) => t.id && t.id !== fromTrack?.id);
    expect(fromTrack?.id).toBeTruthy();
    expect(toTrack?.id).toBeTruthy();

    await moveClipToTrack(page, clipId, toTrack!.id);

    const moved = await waitForTimelineDoc(
      page,
      e2eProject,
      (d) =>
        d.videoTracks.some((t) => t.id === fromTrack!.id && t.clips.length === 0) &&
        d.videoTracks.some((t) => t.id === toTrack!.id && t.clips.length === 1),
    );
    expect(moved.videoTracks.find((t) => t.id === fromTrack!.id)?.clips).toHaveLength(0);
    expect(moved.videoTracks.find((t) => t.id === toTrack!.id)?.clips).toHaveLength(1);

    await page.goto(`/editor/${e2eProject.encodedName}`);
    await waitForEditorReady(page);

    const reloaded = await readTimelineDoc(page, e2eProject);
    expect(reloaded.videoTracks.find((t) => t.id === fromTrack!.id)?.clips).toHaveLength(0);
    expect(reloaded.videoTracks.find((t) => t.id === toTrack!.id)?.clips).toHaveLength(1);
  });
});
