import { test, expect } from '../fixtures/workspace';
import { MEDIA_FIXTURES } from '../../fixtures/media';
import { entry, importViaUpload } from '../../utils/e2e/file-manager';

/**
 * The real web import pipeline through the app's file input. Codec/container
 * ingest breadth lives in media-format-import; timeline/playback/export are not
 * exercised here.
 */
test.describe('Web media import', () => {
  test('imports a supported video into the project', async ({ page, e2eProject }) => {
    await importViaUpload(page, [MEDIA_FIXTURES.video.h264Mp4]);
    await expect(entry(page, 'video-h264-aac.mp4')).toBeVisible({ timeout: 20_000 });

    // Survives a reload → it was really copied into the project, not just shown.
    await page.goto(`/editor/${e2eProject.encodedName}`);
    await expect(page.getByTestId('timeline-container')).toBeVisible();
    await expect(entry(page, 'video-h264-aac.mp4')).toBeVisible({ timeout: 20_000 });
  });

  test('imports a supported audio file', async ({ page }) => {
    await importViaUpload(page, [MEDIA_FIXTURES.audio.wav]);
    await expect(entry(page, 'audio-sine.wav')).toBeVisible({ timeout: 20_000 });
  });

  test('imports a supported image file', async ({ page }) => {
    await importViaUpload(page, [MEDIA_FIXTURES.image.jpg]);
    await expect(entry(page, 'image.jpg')).toBeVisible({ timeout: 20_000 });
  });
});
