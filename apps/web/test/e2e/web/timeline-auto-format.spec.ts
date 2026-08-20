import { test, expect } from '../fixtures/workspace';
import { MEDIA_FIXTURES } from '../../fixtures/media';
import { seedProjectMedia } from '../../utils/e2e/file-manager';
import { addFileToTrack, clipIds, trackIds } from '../../utils/e2e/timeline';
import { opfsEntryExists, readTextFileFromOpfs } from '../../utils/e2e/virtual-fs';

test.describe('Web timeline auto format adoption (E2E Smoke)', () => {
  test('adopts video format into timeline settings when first clip is added to timeline', async ({
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

    await expect
      .poll(
        async () => {
          if (!(await opfsEntryExists(page, e2eProject.timelinePath))) return null;
          try {
            const raw = await readTextFileFromOpfs(page, e2eProject.timelinePath);
            return JSON.parse(raw) as {
              metadata?: {
                fastcat?: {
                  format?: {
                    width?: number;
                    height?: number;
                    geometryResolved?: boolean;
                    useProjectSettings?: boolean;
                  };
                };
              };
            };
          } catch {
            return null;
          }
        },
        { timeout: 15_000 },
      )
      .toEqual(
        expect.objectContaining({
          metadata: expect.objectContaining({
            fastcat: expect.objectContaining({
              format: expect.objectContaining({
                width: 320,
                height: 240,
                geometryResolved: true,
                useProjectSettings: false,
              }),
            }),
          }),
        }),
      );
  });
});
