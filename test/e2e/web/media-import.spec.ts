import { test, expect } from '../fixtures/workspace';
import { MEDIA_FIXTURES } from '../../fixtures/media';
import { importViaUpload, importViaDragDrop } from '../../utils/e2e/file-manager';
import { opfsEntryExists } from '../../utils/e2e/virtual-fs';

/**
 * The real web import pipeline through the app's file input. Codec/container
 * ingest breadth lives in media-format-import; timeline/playback/export are not
 * exercised here.
 */
test.describe('Web media import', () => {
  test('imports a supported video into the project', async ({ page, e2eProject }) => {
    await importViaUpload(page, [MEDIA_FIXTURES.video.h264Mp4]);
    await expect
      .poll(() => opfsEntryExists(page, `${e2eProject.path}/_video/video-h264-aac.mp4`), {
        timeout: 20_000,
      })
      .toBe(true);
  });

  test('imports a supported audio file', async ({ page, e2eProject }) => {
    await importViaUpload(page, [MEDIA_FIXTURES.audio.wav]);
    await expect
      .poll(() => opfsEntryExists(page, `${e2eProject.path}/_audio/audio-sine.wav`), {
        timeout: 20_000,
      })
      .toBe(true);
  });

  test('imports a supported image file', async ({ page, e2eProject }) => {
    await importViaUpload(page, [MEDIA_FIXTURES.image.jpg]);
    await expect
      .poll(() => opfsEntryExists(page, `${e2eProject.path}/_images/image.jpg`), {
        timeout: 20_000,
      })
      .toBe(true);
  });

  test('imports a video via drag-and-drop onto the app', async ({ page, e2eProject }) => {
    await importViaDragDrop(page, [MEDIA_FIXTURES.video.h264Mp4]);
    await expect
      .poll(() => opfsEntryExists(page, `${e2eProject.path}/_video/video-h264-aac.mp4`), {
        timeout: 20_000,
      })
      .toBe(true);
  });
});
