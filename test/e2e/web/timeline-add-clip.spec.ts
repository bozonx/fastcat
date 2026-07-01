import { test, expect } from '../fixtures/workspace';
import { MEDIA_FIXTURES } from '../../fixtures/media';
import { seedProjectMedia } from '../../utils/e2e/file-manager';
import { addFileToTrack, clipIds, trackIds } from '../../utils/e2e/timeline';
import { readTimelineDoc, waitForTimelineDoc } from '../../utils/e2e/otio';

/**
 * Adding media from the project file manager onto timeline tracks.
 * Import correctness lives in media-import; trim/move in their own specs.
 */
test.describe('Web timeline add clip', () => {
  test('adds a video file to the first video track and persists it', async ({
    page,
    e2eProject,
  }) => {
    const { fileName } = await seedProjectMedia(
      page,
      e2eProject,
      MEDIA_FIXTURES.video.h264Mp4,
      'video',
    );

    const videoTrackId = (await trackIds(page))[0];
    await addFileToTrack(page, `${e2eProject.path}/_video/${fileName}`, videoTrackId);

    // UI: a clip is now rendered.
    await expect.poll(async () => (await clipIds(page)).length).toBeGreaterThan(0);

    // Ground truth: it is persisted on a video track referencing the media.
    const doc = await waitForTimelineDoc(page, e2eProject, (d) => d.allClips.length === 1);
    expect(doc.videoTracks.some((t) => t.clips.length === 1)).toBe(true);
    expect(doc.allClips[0].targetUrl ?? '').toContain(fileName);
    expect(doc.allClips[0].timelineDurationUs).toBeGreaterThan(0);
  });

  test('adds an audio file to an audio track', async ({ page, e2eProject }) => {
    const { fileName } = await seedProjectMedia(
      page,
      e2eProject,
      MEDIA_FIXTURES.audio.wav,
      'audio',
    );

    const doc0 = await readTimelineDoc(page, e2eProject);
    const audioTrackName = doc0.audioTracks[0]?.name;
    const audioTrackId = (await trackIds(page)).at(-1)!; // audio lanes render below video

    await addFileToTrack(page, `${e2eProject.path}/_audio/${fileName}`, audioTrackId);

    const doc = await waitForTimelineDoc(page, e2eProject, (d) => d.allClips.length === 1);
    expect(doc.audioTracks.some((t) => t.clips.length === 1)).toBe(true);
    expect(audioTrackName).toBeDefined();
  });

  test('adds an image as a still clip with a non-zero duration', async ({ page, e2eProject }) => {
    const { fileName } = await seedProjectMedia(
      page,
      e2eProject,
      MEDIA_FIXTURES.image.jpg,
      'image',
    );

    const videoTrackId = (await trackIds(page))[0];
    await addFileToTrack(page, `${e2eProject.path}/_images/${fileName}`, videoTrackId);

    const doc = await waitForTimelineDoc(page, e2eProject, (d) => d.allClips.length === 1);
    expect(doc.allClips[0].timelineDurationUs).toBeGreaterThan(0);
  });

  test('added clip survives a reload', async ({ page, e2eProject }) => {
    const { fileName } = await seedProjectMedia(
      page,
      e2eProject,
      MEDIA_FIXTURES.video.h264Mp4,
      'video',
    );
    const videoTrackId = (await trackIds(page))[0];
    await addFileToTrack(page, `${e2eProject.path}/_video/${fileName}`, videoTrackId);
    await waitForTimelineDoc(page, e2eProject, (d) => d.allClips.length === 1);

    await page.goto(`/editor/${e2eProject.encodedName}`);
    await expect(page.getByTestId('timeline-container')).toBeVisible();
    await expect.poll(async () => (await clipIds(page)).length).toBe(1);
  });
});
