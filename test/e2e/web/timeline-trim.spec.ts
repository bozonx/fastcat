import type { Page } from '@playwright/test';
import { test, expect, waitForEditorReady } from '../fixtures/workspace';
import type { E2eProject } from '../fixtures/workspace';
import { MEDIA_FIXTURES } from '../../fixtures/media';
import { seedProjectMedia } from '../../utils/e2e/file-manager';
import { addFileToTrack, clipIds, trackIds, trimClipEdge } from '../../utils/e2e/timeline';
import { readTimelineDoc, waitForTimelineDoc } from '../../utils/e2e/otio';

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

    await trimClipEdge(page, clipId, 'end', -400_000);

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

    await trimClipEdge(page, clipId, 'start', 400_000);

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
    await trimClipEdge(page, clipId, 'end', -50_000_000);

    const doc = await waitForTimelineDoc(page, e2eProject, (d) => d.allClips.length === 1);
    expect(doc.allClips[0].timelineDurationTicks).toBeGreaterThan(0);
  });

  test('cannot trim the start before the source in-point', async ({ page, e2eProject }) => {
    const clipId = await projectWithOneClip(page, e2eProject);
    const before = (await readTimelineDoc(page, e2eProject)).allClips[0];

    await trimClipEdge(page, clipId, 'start', -50_000_000);

    const doc = await waitForTimelineDoc(page, e2eProject, (d) => d.allClips.length === 1);
    expect(doc.allClips[0].sourceStartTicks).toBe(before.sourceStartTicks);
    expect(doc.allClips[0].timelineDurationTicks).toBe(before.timelineDurationTicks);
  });

  test('trimmed clip persists across reload', async ({ page, e2eProject }) => {
    const clipId = await projectWithOneClip(page, e2eProject);
    const before = (await readTimelineDoc(page, e2eProject)).allClips[0].timelineDurationTicks;
    await trimClipEdge(page, clipId, 'end', -400_000);
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
