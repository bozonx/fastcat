import { test, expect } from '../fixtures/workspace';
import { MEDIA_FIXTURES } from '../../fixtures/media';
import { seedProjectMedia } from '../../utils/e2e/file-manager';
import { addFileToTrack, clipIds, trackIds } from '../../utils/e2e/timeline';
import { waitForTimelineDoc } from '../../utils/e2e/otio';
import { expectPlayheadAdvances, playheadX, seekRulerFraction } from '../../utils/e2e/transport';

/**
 * Editor transport + playhead. Numeric audio-graph validation stays in
 * audio-playback; visual parity + native monitor are out of scope.
 */
test.describe('Web editor playback', () => {
  test.beforeEach(async ({ page, e2eProject }) => {
    const { uiPath } = await seedProjectMedia(
      page,
      e2eProject,
      MEDIA_FIXTURES.video.h264Mp4,
      'video',
    );
    const videoTrackId = (await trackIds(page))[0];
    await addFileToTrack(page, uiPath, videoTrackId);
    await waitForTimelineDoc(page, e2eProject, (d) => d.allClips.length === 1);
    await expect.poll(async () => (await clipIds(page)).length).toBe(1);
  });

  test('play advances the playhead and pause stops it', async ({ page }) => {
    await expectPlayheadAdvances(page, { forMs: 700 });

    // After pause the playhead should hold position.
    const settled = await playheadX(page);
    await page.waitForTimeout(300);
    expect(Math.abs((await playheadX(page)) - settled)).toBeLessThan(2);
  });

  test('seeking on the ruler moves the playhead', async ({ page }) => {
    const start = await playheadX(page);
    await seekRulerFraction(page, 0.5);
    await expect.poll(async () => (await playheadX(page)) - start).toBeGreaterThan(5);
  });

  test('timeline still plays after a reload', async ({ page, e2eProject }) => {
    await page.goto(`/editor/${e2eProject.encodedName}`);
    await expect(page.getByTestId('timeline-container')).toBeVisible();
    await expect.poll(async () => (await clipIds(page)).length).toBe(1);
    await expectPlayheadAdvances(page, { forMs: 700 });
  });
});
