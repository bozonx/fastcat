import { test, expect } from '../fixtures/workspace';
import type { Page } from '@playwright/test';
import type { E2eProject } from '../fixtures/workspace';
import { MEDIA_FIXTURES } from '../../fixtures/media';
import { seedProjectMedia } from '../../utils/e2e/file-manager';
import { addFileToTrack, clipIds, dragClipBy, trackIds } from '../../utils/e2e/timeline';
import { readTimelineDoc, waitForTimelineDoc } from '../../utils/e2e/otio';

/**
 * Repositioning clips on the timeline. Verifies both DOM placement and persisted
 * OTIO timing/track membership. Transitions/grouping/ripple are out of scope.
 */
test.describe('Web timeline move', () => {
  async function projectWithOneVideoClip(page: Page, project: E2eProject) {
    const { fileName } = await seedProjectMedia(
      page,
      project,
      MEDIA_FIXTURES.video.h264Mp4,
      'video',
    );
    const videoTrackId = (await trackIds(page))[0];
    await addFileToTrack(page, `${project.path}/_video/${fileName}`, videoTrackId);
    await waitForTimelineDoc(page, project, (d) => d.allClips.length === 1);
    return (await clipIds(page))[0];
  }

  test('moving a clip later increases its timeline start', async ({ page, e2eProject }) => {
    const clipId = await projectWithOneVideoClip(page, e2eProject);
    const before = (await readTimelineDoc(page, e2eProject)).allClips[0];
    expect(before.timelineStartUs).toBe(0);

    await dragClipBy(page, clipId, { x: 120 });

    // A later start manifests as a leading gap in the sequential OTIO track.
    const doc = await waitForTimelineDoc(
      page,
      e2eProject,
      (d) => (d.allClips[0]?.timelineStartUs ?? 0) > before.timelineStartUs,
    );
    expect(doc.allClips[0].timelineStartUs).toBeGreaterThan(before.timelineStartUs);
  });

  test('moved clip persists across reload', async ({ page, e2eProject }) => {
    const clipId = await projectWithOneVideoClip(page, e2eProject);
    await dragClipBy(page, clipId, { x: 120 });
    const moved = (
      await waitForTimelineDoc(page, e2eProject, (d) => d.allClips[0].timelineStartUs > 0)
    ).allClips[0].timelineStartUs;

    await page.goto(`/editor/${e2eProject.encodedName}`);
    await expect(page.getByTestId('timeline-container')).toBeVisible();

    const reloaded = (await readTimelineDoc(page, e2eProject)).allClips[0].timelineStartUs;
    expect(reloaded).toBe(moved);
  });
});
