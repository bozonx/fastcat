import { test, expect, waitForEditorReady } from '../fixtures/workspace';
import { MEDIA_FIXTURES } from '../../fixtures/media';
import { seedProjectMedia } from '../../utils/e2e/file-manager';
import { addFileToTrack, clipIds, trackIds, updateClipProperties } from '../../utils/e2e/timeline';
import { waitForTimelineDoc } from '../../utils/e2e/otio';
import { TICKS_PER_MICROSECOND } from '~/utils/time';

/**
 * Clip-level audio properties: gain, balance (pan), and fade in/out. Tests
 * drive the update command through the real UI hook and assert that the values
 * are written to the persisted OTIO document.
 */
test.describe('Web clip audio properties', () => {
  test('updates audio gain, balance, and fades on an audio clip', async ({ page, e2eProject }) => {
    const { uiPath } = await seedProjectMedia(page, e2eProject, MEDIA_FIXTURES.audio.wav, 'audio');
    const audioTrackId = (await trackIds(page)).at(-1)!;
    await addFileToTrack(page, uiPath, audioTrackId);

    await waitForTimelineDoc(page, e2eProject, (d) => d.allClips.length === 1);
    const clipId = (await clipIds(page))[0];

    await updateClipProperties(page, {
      itemId: clipId,
      properties: {
        audioGain: 0.5,
        audioBalance: -0.5,
        audioFadeInUs: 100_000 * TICKS_PER_MICROSECOND,
        audioFadeOutUs: 100_000 * TICKS_PER_MICROSECOND,
        audioFadeInCurve: 'logarithmic',
        audioFadeOutCurve: 'logarithmic',
        audioMuted: true,
      },
    });

    const updated = await waitForTimelineDoc(
      page,
      e2eProject,
      (d) => d.allClips[0]?.audioGain === 0.5,
    );
    const clip = updated.allClips[0];
    expect(clip.audioGain).toBe(0.5);
    expect(clip.audioBalance).toBe(-0.5);
    expect(clip.audioFadeInUs).toBe(100_000 * TICKS_PER_MICROSECOND);
    expect(clip.audioFadeOutUs).toBe(100_000 * TICKS_PER_MICROSECOND);
    expect(clip.audioFadeInCurve).toBe('logarithmic');
    expect(clip.audioFadeOutCurve).toBe('logarithmic');
    expect(clip.audioMuted).toBe(true);

    // Reload should preserve the audio settings.
    await page.goto(`/editor/${e2eProject.encodedName}`);
    await waitForEditorReady(page);
    const reloaded = await waitForTimelineDoc(page, e2eProject, (d) => d.allClips.length === 1);
    const reloadedClip = reloaded.allClips[0];
    expect(reloadedClip.audioGain).toBe(0.5);
    expect(reloadedClip.audioBalance).toBe(-0.5);
    expect(reloadedClip.audioFadeInUs).toBe(100_000 * TICKS_PER_MICROSECOND);
    expect(reloadedClip.audioMuted).toBe(true);
  });
});
