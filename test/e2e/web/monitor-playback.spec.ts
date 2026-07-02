import { test, expect } from '../fixtures/workspace';
import { MEDIA_FIXTURES } from '../../fixtures/media';
import { seedProjectMedia } from '../../utils/e2e/file-manager';
import { addFileToTrack, clipIds, trackIds } from '../../utils/e2e/timeline';
import { waitForTimelineDoc } from '../../utils/e2e/otio';
import {
  expectPlayheadAdvances,
  getMonitorAudioState,
  playheadX,
  seekMonitorToFraction,
  setMonitorVolume,
  toggleMonitorMute,
} from '../../utils/e2e/transport';

/**
 * Monitor playback controls: play/pause, seekbar scrubbing, and monitor
 * audio mute state. Visual parity and native monitor output are out of scope.
 */
test.describe('Web monitor playback controls', () => {
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
  });

  test('expectPlayheadAdvances helper starts and stops playback', async ({ page }) => {
    const delta = await expectPlayheadAdvances(page, { forMs: 700 });
    expect(delta).toBeGreaterThan(0);
  });

  test('clicking the monitor seekbar moves the playhead forward', async ({ page }) => {
    const startX = await playheadX(page);
    await seekMonitorToFraction(page, 0.5);
    await expect
      .poll(async () => (await playheadX(page)) - startX, { timeout: 2_000 })
      .toBeGreaterThan(1);
  });

  test('toggling monitor mute flips the muted state', async ({ page }) => {
    const before = await getMonitorAudioState(page);
    await toggleMonitorMute(page);
    const after = await getMonitorAudioState(page);
    expect(after.muted).toBe(!before.muted);
    await expect.poll(async () => (await clipIds(page)).length).toBe(1);
  });

  test('setting the monitor volume updates the audio state', async ({ page }) => {
    await setMonitorVolume(page, 0.25);
    const state = await getMonitorAudioState(page);
    expect(state.volume).toBe(0.25);
  });
});
