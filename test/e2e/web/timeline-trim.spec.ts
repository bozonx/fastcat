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
    const before = (await readTimelineDoc(page, e2eProject)).allClips[0].timelineDurationUs;

    await trimClipEdge(page, clipId, 'end', -40);

    const doc = await waitForTimelineDoc(
      page,
      e2eProject,
      (d) => d.allClips[0].timelineDurationUs < before,
    );
    expect(doc.allClips[0].timelineDurationUs).toBeLessThan(before);
  });

  test('trimming the start updates source offset and duration', async ({ page, e2eProject }) => {
    const clipId = await projectWithOneClip(page, e2eProject);
    const c0 = (await readTimelineDoc(page, e2eProject)).allClips[0];

    await trimClipEdge(page, clipId, 'start', 40);

    const doc = await waitForTimelineDoc(
      page,
      e2eProject,
      (d) => d.allClips[0].timelineDurationUs < c0.timelineDurationUs,
    );
    const c1 = doc.allClips[0];
    expect(c1.timelineDurationUs).toBeLessThan(c0.timelineDurationUs);
    // Trimming in from the head advances the source in-point.
    expect(c1.sourceStartUs).toBeGreaterThanOrEqual(c0.sourceStartUs);
  });

  test('cannot trim below the minimum duration', async ({ page, e2eProject }) => {
    const clipId = await projectWithOneClip(page, e2eProject);

    // Drag the end handle far past the clip's own start.
    await trimClipEdge(page, clipId, 'end', -5000);

    const doc = await waitForTimelineDoc(page, e2eProject, (d) => d.allClips.length === 1);
    expect(doc.allClips[0].timelineDurationUs).toBeGreaterThan(0);
  });

  test('cannot trim the start before the source in-point', async ({ page, e2eProject }) => {
    const clipId = await projectWithOneClip(page, e2eProject);
    const before = (await readTimelineDoc(page, e2eProject)).allClips[0];

    await trimClipEdge(page, clipId, 'start', -500);

    const doc = await waitForTimelineDoc(page, e2eProject, (d) => d.allClips.length === 1);
    expect(doc.allClips[0].sourceStartUs).toBe(before.sourceStartUs);
    expect(doc.allClips[0].timelineDurationUs).toBe(before.timelineDurationUs);
  });

  test('trimmed clip persists across reload', async ({ page, e2eProject }) => {
    const clipId = await projectWithOneClip(page, e2eProject);
    const before = (await readTimelineDoc(page, e2eProject)).allClips[0].timelineDurationUs;
    await trimClipEdge(page, clipId, 'end', -40);
    const trimmed = (
      await waitForTimelineDoc(page, e2eProject, (d) => d.allClips[0].timelineDurationUs < before)
    ).allClips[0].timelineDurationUs;

    await page.goto(`/editor/${e2eProject.encodedName}`);
    await waitForEditorReady(page);

    const reloaded = (await readTimelineDoc(page, e2eProject)).allClips[0].timelineDurationUs;
    expect(reloaded).toBe(trimmed);
  });
});
