import { test, expect } from '../fixtures/workspace';
import { MEDIA_FIXTURES } from '../../fixtures/media';
import { seedProjectMedia } from '../../utils/e2e/file-manager';
import { addFileToTrack, clipIds, trackIds } from '../../utils/e2e/timeline';
import { opfsEntryExists, readTextFileFromOpfs } from '../../utils/e2e/virtual-fs';

test.describe('Web timeline auto format adoption (E2E Smoke)', () => {
  test('adopts video format into project settings when first clip is added to timeline', async ({
    page,
    e2eProject,
  }) => {
    const { uiPath } = await seedProjectMedia(
      page,
      e2eProject,
      MEDIA_FIXTURES.video.h264Mp4,
      'video',
    );

    const videoTrackId = (await trackIds(page))[0];
    await addFileToTrack(page, uiPath, videoTrackId);

    // Ensure clip is added to timeline in UI
    await expect.poll(async () => (await clipIds(page)).length).toBeGreaterThan(0);

    // Verify project settings file is persisted in OPFS with auto-adopted geometry
    const settingsPath = `${e2eProject.path}/.fastcat/project.settings.json`;

    await expect
      .poll(
        async () => {
          if (!(await opfsEntryExists(page, settingsPath))) return null;
          try {
            const raw = await readTextFileFromOpfs(page, settingsPath);
            return JSON.parse(raw) as {
              project?: { width?: number; height?: number; geometryResolved?: boolean };
            };
          } catch {
            return null;
          }
        },
        { timeout: 15_000 },
      )
      .toEqual(
        expect.objectContaining({
          project: expect.objectContaining({
            width: 1920,
            height: 1080,
            geometryResolved: true,
          }),
        }),
      );
  });
});
