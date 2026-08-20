import { test, expect } from '../fixtures/workspace';
import { MEDIA_FIXTURES, mediaFixture } from '../../fixtures/media';
import { importViaUpload, importViaDragDrop } from '../../utils/e2e/file-manager';
import { opfsEntryExists } from '../../utils/e2e/virtual-fs';

const TIMELINE_FIXTURE = mediaFixture('timeline/sample.otio');

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

  test('imports duplicate files with unique names', async ({ page, e2eProject }) => {
    await importViaUpload(page, [MEDIA_FIXTURES.audio.wav]);
    await importViaUpload(page, [MEDIA_FIXTURES.audio.wav]);

    await expect
      .poll(() => opfsEntryExists(page, `${e2eProject.path}/_audio/audio-sine.wav`), {
        timeout: 20_000,
      })
      .toBe(true);
    await expect
      .poll(() => opfsEntryExists(page, `${e2eProject.path}/_audio/audio-sine (1).wav`), {
        timeout: 20_000,
      })
      .toBe(true);
  });

  test('imports multiple files via drag-and-drop', async ({ page, e2eProject }) => {
    await importViaDragDrop(page, [MEDIA_FIXTURES.video.h264Mp4, MEDIA_FIXTURES.audio.wav]);

    await expect
      .poll(() => opfsEntryExists(page, `${e2eProject.path}/_video/video-h264-aac.mp4`), {
        timeout: 20_000,
      })
      .toBe(true);
    await expect
      .poll(() => opfsEntryExists(page, `${e2eProject.path}/_audio/audio-sine.wav`), {
        timeout: 20_000,
      })
      .toBe(true);
  });

  test('skips timeline files during media import', async ({ page, e2eProject }) => {
    await importViaUpload(page, [TIMELINE_FIXTURE]);
    await page.waitForTimeout(500);

    await expect
      .poll(() => opfsEntryExists(page, `${e2eProject.path}/_timelines/sample.otio`), {
        timeout: 5_000,
      })
      .toBe(false);
    await expect
      .poll(() => opfsEntryExists(page, `${e2eProject.path}/sample.otio`), { timeout: 5_000 })
      .toBe(false);
  });
});
