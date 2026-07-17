import type { Page } from '@playwright/test';
import { test, expect, waitForEditorReady } from '../fixtures/workspace';
import type { E2eProject } from '../fixtures/workspace';
import { MEDIA_FIXTURES } from '../../fixtures/media';
import { seedProjectMedia } from '../../utils/e2e/file-manager';
import { addFileToTrack, clipIds, trackIds, trimClipEdge } from '../../utils/e2e/timeline';
import { readTimelineDoc, waitForTimelineDoc } from '../../utils/e2e/otio';
import { secondsToTicks } from '~/utils/time';

// The canonical tick base is Premiere-compatible (TICKS_PER_SECOND = 254_016_000_000),
// so trim/move deltas must be expressed in whole-frame tick magnitudes — the old
// microsecond-scale literals (e.g. -400_000) are sub-frame here and quantize to a
// no-op. Express intents as wall-clock seconds instead.
const TRIM_END_0_4S = -secondsToTicks({ seconds: 0.4 });
const TRIM_START_0_4S = secondsToTicks({ seconds: 0.4 });
// A delta far past the clip's own extent, to exercise the minimum-duration / source
// in-point clamps.
const TRIM_FAR_PAST = -secondsToTicks({ seconds: 5 });

/**
 * Trimming a single clip via its edge handles. Each test does one trim and
 * verifies the persisted source/timeline range. Split/ripple/transitions are
 * out of scope (feature-flagged or separate specs).
 */
test.describe('Web timeline trim', () => {
  async function projectWithOneClip(page: Page, project: E2eProject) {
    const { uiPath } = await seedProjectMedia(page, project, MEDIA_FIXTURES.video.h264Mp4, 'video');
    const videoTrackId = (await trackIds(page))[0];
    await addFileToTrack(page, uiPath, videoTrackId);
    await waitForTimelineDoc(page, project, (d) => d.allClips.length === 1);
    return (await clipIds(page))[0];
  }

  test('trimming the end shortens the clip duration', async ({ page, e2eProject }) => {
    const clipId = await projectWithOneClip(page, e2eProject);
    const before = (await readTimelineDoc(page, e2eProject)).allClips[0].timelineDurationTicks;

    await trimClipEdge(page, clipId, 'end', TRIM_END_0_4S);

    const doc = await waitForTimelineDoc(
      page,
      e2eProject,
      (d) => d.allClips[0].timelineDurationTicks < before,
    );
    expect(doc.allClips[0].timelineDurationTicks).toBeLessThan(before);
  });

  test('trimming the start updates source offset and duration', async ({ page, e2eProject }) => {
    const clipId = await projectWithOneClip(page, e2eProject);
    const c0 = (await readTimelineDoc(page, e2eProject)).allClips[0];

    await trimClipEdge(page, clipId, 'start', TRIM_START_0_4S);

    const doc = await waitForTimelineDoc(
      page,
      e2eProject,
      (d) => d.allClips[0].timelineDurationTicks < c0.timelineDurationTicks,
    );
    const c1 = doc.allClips[0];
    expect(c1.timelineDurationTicks).toBeLessThan(c0.timelineDurationTicks);
    // Trimming in from the head advances the source in-point.
    expect(c1.sourceStartTicks).toBeGreaterThanOrEqual(c0.sourceStartTicks);
  });

  test('cannot trim below the minimum duration', async ({ page, e2eProject }) => {
    const clipId = await projectWithOneClip(page, e2eProject);

    // Drag the end handle far past the clip's own start.
    await trimClipEdge(page, clipId, 'end', TRIM_FAR_PAST);

    const doc = await waitForTimelineDoc(page, e2eProject, (d) => d.allClips.length === 1);
    expect(doc.allClips[0].timelineDurationTicks).toBeGreaterThan(0);
  });

  test('cannot trim the start before the source in-point', async ({ page, e2eProject }) => {
    const clipId = await projectWithOneClip(page, e2eProject);
    const before = (await readTimelineDoc(page, e2eProject)).allClips[0];

    await trimClipEdge(page, clipId, 'start', TRIM_FAR_PAST);

    const doc = await waitForTimelineDoc(page, e2eProject, (d) => d.allClips.length === 1);
    expect(doc.allClips[0].sourceStartTicks).toBe(before.sourceStartTicks);
    expect(doc.allClips[0].timelineDurationTicks).toBe(before.timelineDurationTicks);
  });

  test('trimmed clip persists across reload', async ({ page, e2eProject }) => {
    const clipId = await projectWithOneClip(page, e2eProject);
    const before = (await readTimelineDoc(page, e2eProject)).allClips[0].timelineDurationTicks;
    await trimClipEdge(page, clipId, 'end', TRIM_END_0_4S);
    const trimmed = (
      await waitForTimelineDoc(
        page,
        e2eProject,
        (d) => d.allClips[0].timelineDurationTicks < before,
      )
    ).allClips[0].timelineDurationTicks;

    await page.goto(`/editor/${e2eProject.encodedName}`);
    await waitForEditorReady(page);

    const reloaded = (await readTimelineDoc(page, e2eProject)).allClips[0].timelineDurationTicks;
    expect(reloaded).toBe(trimmed);
  });
});
