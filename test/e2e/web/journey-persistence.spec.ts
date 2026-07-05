import { test, expect, waitForEditorReady } from '../fixtures/workspace';
import { MEDIA_FIXTURES } from '../../fixtures/media';
import { seedProjectMedia, navigateToFolder } from '../../utils/e2e/file-manager';
import {
  addFileToTrack,
  clipIds,
  dragClipBy,
  saveTimeline,
  selectClip,
  trackIds,
  trimClipEdge,
} from '../../utils/e2e/timeline';
import { waitForTimelineDoc } from '../../utils/e2e/otio';
import { openExport, startExport, waitForExportSuccess } from '../../utils/e2e/transport';
import { listOpfsDirectory, readFileFromOpfs } from '../../utils/e2e/virtual-fs';

/**
 * Persistence User Journey E2E Test:
 * Active Editing → Page Reload → Check OTIO/OPFS Persistence → Further Editing → Export.
 *
 * Verifies that active edits survive page reloads and state re-hydration, and that
 * post-reload edits can be successfully exported.
 */
test.describe('Persistence User Journey', () => {
  test.slow();

  test('executes active editing → reload → verify persistence → continue edit → export', async ({
    page,
    e2eProject,
  }) => {
    // 1. Initial active editing phase
    const video = await seedProjectMedia(page, e2eProject, MEDIA_FIXTURES.video.h264Mp4, 'video');
    const audio = await seedProjectMedia(page, e2eProject, MEDIA_FIXTURES.audio.wav, 'audio');

    const tracks = await trackIds(page);
    const videoTrackId = tracks[0];
    const audioTrackId = tracks.at(-1)!;

    await navigateToFolder(page, '_video');
    await addFileToTrack(page, video.uiPath, videoTrackId);

    const doc0 = await waitForTimelineDoc(page, e2eProject, (d) => d.allClips.length === 1);
    const initialClipId = (await clipIds(page))[0];

    // Perform edits: trim video clip and apply effect
    await trimClipEdge(page, initialClipId, 'end', -300_000);
    const trimmedDoc = await waitForTimelineDoc(
      page,
      e2eProject,
      (d) => d.allClips[0].timelineDurationUs < doc0.allClips[0].timelineDurationUs,
    );
    const editedDurationUs = trimmedDoc.allClips[0].timelineDurationUs;

    await selectClip(page, initialClipId);
    await page.getByRole('tab', { name: 'Video' }).click();
    await page.getByTestId('clip-effects-video-add').click();
    await page.getByTestId('select-effect-color-adjustment').click();

    const brightnessInput = page
      .getByTestId('clip-effect-color-adjustment-param-brightness')
      .locator('input');
    await brightnessInput.fill('1.4');
    await brightnessInput.blur();
    await saveTimeline(page);

    const docPhase1 = await waitForTimelineDoc(page, e2eProject, (d) => {
      const effect = d.allClips[0]?.effects.find((e) => e.type === 'color-adjustment');
      return effect?.params.brightness === 1.4;
    });
    expect(docPhase1.allClips[0].timelineDurationUs).toBe(editedDurationUs);

    // 2. Page Reload
    await page.goto(`/editor/${e2eProject.encodedName}`);
    await waitForEditorReady(page);
    await expect.poll(async () => (await clipIds(page)).length).toBe(1);

    // 3. Verify OTIO/OPFS persistence after reload
    const docReloaded = await waitForTimelineDoc(page, e2eProject, (d) => d.allClips.length === 1);
    expect(docReloaded.allClips[0].timelineDurationUs).toBe(editedDurationUs);
    expect(
      docReloaded.allClips[0].effects.some(
        (e) => e.type === 'color-adjustment' && e.params.brightness === 1.4,
      ),
    ).toBe(true);

    // 4. Continue editing after reload
    await navigateToFolder(page, '_audio');
    await expect(page.locator(`[data-entry-path="${audio.uiPath}"]`)).toBeVisible({
      timeout: 5_000,
    });
    await addFileToTrack(page, audio.uiPath, audioTrackId);

    const docPhase2 = await waitForTimelineDoc(page, e2eProject, (d) => d.allClips.length === 2);
    expect(docPhase2.audioTracks.some((t) => t.clips.length === 1)).toBe(true);

    const allClipIds = await clipIds(page);
    const audioClipId = allClipIds[1];
    await dragClipBy(page, audioClipId, { x: 500_000 });
    await waitForTimelineDoc(page, e2eProject, (d) => (d.allClips[1]?.timelineStartUs ?? 0) > 0);

    // 5. Export final result after post-reload editing
    await openExport(page);
    await startExport(page);
    await waitForExportSuccess(page, { timeout: 90_000 });

    const outputs = await listOpfsDirectory(page, `${e2eProject.path}/_export`);
    const exportedFiles = outputs.filter((entry) => entry.kind === 'file');
    expect(exportedFiles.length).toBeGreaterThan(0);

    const exportedPath = `${e2eProject.path}/_export/${exportedFiles[0]!.name}`;
    const bytes = await readFileFromOpfs(page, exportedPath);
    expect(bytes.byteLength).toBeGreaterThan(0);
  });
});
