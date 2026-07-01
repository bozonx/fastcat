import { test, expect } from '../fixtures/workspace';
import { MEDIA_FIXTURES } from '../../fixtures/media';
import { seedProjectMedia } from '../../utils/e2e/file-manager';
import { addFileToTrack, trackIds } from '../../utils/e2e/timeline';
import { waitForTimelineDoc } from '../../utils/e2e/otio';
import { openExport, startExport, waitForExportSuccess } from '../../utils/e2e/transport';
import { listOpfsDirectory } from '../../utils/e2e/virtual-fs';

/**
 * Base web export of a short timeline. Premium presets, native/hardware export,
 * conversion-only paths and pixel parity are out of scope (parity specs cover
 * frame correctness).
 */
test.describe('Web export', () => {
  test.slow(); // real encode of a short clip

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

  test('opens the export panel and shows the start control', async ({ page }) => {
    await openExport(page);
    await expect(page.getByTestId('export-start')).toBeEnabled();
  });

  test('runs a short export to completion and writes an output file', async ({
    page,
    e2eProject,
  }) => {
    await openExport(page);
    await startExport(page);
    await waitForExportSuccess(page, { timeout: 90_000 });

    const outputs = await listOpfsDirectory(page, `${e2eProject.path}/_export`);
    expect(outputs.length).toBeGreaterThan(0);
  });
});
