import { test, expect } from '../fixtures/workspace';
import { MEDIA_FIXTURES } from '../../fixtures/media';
import { seedProjectMedia, navigateToFolder } from '../../utils/e2e/file-manager';
import {
  addFileToTrack,
  clipIds,
  saveTimeline,
  selectClip,
  trackIds,
  trimClipEdge,
} from '../../utils/e2e/timeline';
import { waitForTimelineDoc } from '../../utils/e2e/otio';
import { openExport, startExport, waitForExportSuccess } from '../../utils/e2e/transport';
import { listOpfsDirectory, readFileFromOpfs } from '../../utils/e2e/virtual-fs';

/**
 * Main Editing User Journey E2E Test:
 * Import media → Multi-track timeline editing → Clip effect application → Export.
 *
 * Verifies that a full user workflow across multiple editor subsystems works in
 * sequence and results in a valid exported file.
 */
test.describe('Main Editing User Journey', () => {
  test.slow();

  test('executes full journey: import → multi-track edit → apply effect → export', async ({
    page,
    e2eProject,
  }) => {
    // 1. Seed/Import media (video and audio)
    const video = await seedProjectMedia(page, e2eProject, MEDIA_FIXTURES.video.h264Mp4, 'video');
    const audio = await seedProjectMedia(page, e2eProject, MEDIA_FIXTURES.audio.wav, 'audio');

    // 2. Multi-track editing: Add video to video track, audio to audio track
    const allTracks = await trackIds(page);
    const videoTrackId = allTracks[0];
    const audioTrackId = allTracks.at(-1)!;

    await navigateToFolder(page, '_video');
    await expect(page.locator(`[data-entry-path="${video.uiPath}"]`)).toBeVisible({
      timeout: 5_000,
    });
    await addFileToTrack(page, video.uiPath, videoTrackId);

    await navigateToFolder(page, '_audio');
    await expect(page.locator(`[data-entry-path="${audio.uiPath}"]`)).toBeVisible({
      timeout: 5_000,
    });
    await addFileToTrack(page, audio.uiPath, audioTrackId);

    const docMultiTrack = await waitForTimelineDoc(
      page,
      e2eProject,
      (d) => d.allClips.length === 2,
    );
    expect(docMultiTrack.videoTracks.some((t) => t.clips.length === 1)).toBe(true);
    expect(docMultiTrack.audioTracks.some((t) => t.clips.length === 1)).toBe(true);

    const currentClipIds = await clipIds(page);
    const videoClipId = currentClipIds[0];

    // Trim video clip slightly to verify edit operation
    await trimClipEdge(page, videoClipId, 'end', -200_000);
    await waitForTimelineDoc(
      page,
      e2eProject,
      (d) => d.allClips[0].timelineDurationTicks < docMultiTrack.allClips[0].timelineDurationTicks,
    );

    // 3. Clip Effects: Select video clip and apply color adjustment
    await selectClip(page, videoClipId);
    await page.getByRole('tab', { name: 'Video' }).click();

    await page.getByTestId('clip-effects-video-add').click();
    await page.getByTestId('select-effect-color-adjustment').click();
    await expect(page.getByTestId('clip-effect-color-adjustment')).toBeVisible();

    const brightnessInput = page
      .getByTestId('clip-effect-color-adjustment-param-brightness')
      .locator('input');
    await brightnessInput.fill('1.25');
    await brightnessInput.blur();
    await saveTimeline(page);

    const docWithEffect = await waitForTimelineDoc(page, e2eProject, (doc) => {
      const effect = doc.allClips[0]?.effects.find((e) => e.type === 'color-adjustment');
      return effect?.params.brightness === 1.25;
    });
    expect(docWithEffect.allClips[0].effects).toHaveLength(1);

    // 4. Export: Trigger export flow and verify generated output
    await openExport(page);
    await startExport(page);
    await waitForExportSuccess(page, { timeout: 90_000 });

    const outputs = await listOpfsDirectory(page, `${e2eProject.path}/_export`);
    const exportedFiles = outputs.filter((entry) => entry.kind === 'file');
    expect(exportedFiles.length).toBeGreaterThan(0);

    const exportedFile = exportedFiles[0]!;
    expect(exportedFile.name).toMatch(/\.(mp4|webm|mkv)$/i);

    const exportedPath = `${e2eProject.path}/_export/${exportedFile.name}`;
    const bytes = await readFileFromOpfs(page, exportedPath);
    expect(bytes.byteLength).toBeGreaterThan(0);
  });
});
