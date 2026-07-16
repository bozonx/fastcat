import { test, expect } from '../fixtures/workspace';
import { addTextClipAtPlayhead, addFileToTrack, trackIds } from '../../utils/e2e/timeline';
import { waitForTimelineDoc } from '../../utils/e2e/otio';
import { MEDIA_FIXTURES } from '../../fixtures/media';
import { seedProjectMedia } from '../../utils/e2e/file-manager';
import { openExport, startExport, waitForExportSuccess } from '../../utils/e2e/transport';
import { listOpfsDirectory, readFileFromOpfs } from '../../utils/e2e/virtual-fs';

test.describe('Web text clip render/export', () => {
  test.slow();

  test('renders a styled text clip in the monitor and exports it', async ({ page, e2eProject }) => {
    const [videoTrackId] = await trackIds(page);
    const [clipId] = await addTextClipAtPlayhead(page, {
      trackId: videoTrackId,
      durationTicks: 1_000_000,
      text: 'Styled\nText',
      style: {
        width: 720,
        fontSize: 96,
        fontWeight: '800',
        color: '#ffffff',
        textShadowEnabled: true,
        textShadowColor: '#000000',
        textShadowBlur: 10,
        textShadowOffsetY: 6,
        backgroundEnabled: true,
        backgroundColor: '#2563eb',
        backgroundRadius: 18,
        borderEnabled: true,
        borderColor: '#facc15',
        borderWidth: 8,
        padding: { top: 40, right: 70, bottom: 40, left: 70 },
        paddingLinked: false,
      },
    });
    expect(clipId).toBeTruthy();

    await waitForTimelineDoc(page, e2eProject, (doc) =>
      doc.allClips.some((clip) => clip.id === clipId),
    );

    await page.getByRole('button', { name: 'Cut', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Fullscreen' })).toBeVisible({
      timeout: 20_000,
    });

    await openExport(page);
    await startExport(page);
    await waitForExportSuccess(page, { timeout: 90_000 });

    const outputs = await listOpfsDirectory(page, `${e2eProject.path}/_export`);
    const exportedFile = outputs.find((entry) => entry.kind === 'file');
    expect(exportedFile?.name).toMatch(/\.(mp4|webm|mkv)$/i);

    const bytes = await readFileFromOpfs(page, `${e2eProject.path}/_export/${exportedFile!.name}`);
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  test('exports a styled text clip over a video background', async ({ page, e2eProject }) => {
    const { uiPath } = await seedProjectMedia(
      page,
      e2eProject,
      MEDIA_FIXTURES.video.h264Mp4,
      'video',
    );
    const [videoTrackId, textTrackId] = await trackIds(page);

    await addFileToTrack(page, uiPath, videoTrackId);
    await waitForTimelineDoc(page, e2eProject, (d) => d.allClips.length === 1);

    const [clipId] = await addTextClipAtPlayhead(page, {
      trackId: textTrackId,
      durationTicks: 1_000_000,
      text: 'Overlay',
      style: {
        width: 720,
        fontSize: 96,
        fontWeight: '800',
        color: '#ffffff',
        textShadowEnabled: true,
        textShadowColor: '#000000',
        textShadowBlur: 10,
        textShadowOffsetY: 6,
        backgroundEnabled: true,
        backgroundColor: '#2563eb',
        backgroundRadius: 18,
        borderEnabled: true,
        borderColor: '#facc15',
        borderWidth: 8,
        padding: { top: 40, right: 70, bottom: 40, left: 70 },
        paddingLinked: false,
      },
    });
    expect(clipId).toBeTruthy();

    await waitForTimelineDoc(page, e2eProject, (doc) =>
      doc.allClips.some((clip) => clip.id === clipId),
    );

    await page.getByRole('button', { name: 'Cut', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Fullscreen' })).toBeVisible({
      timeout: 20_000,
    });

    await openExport(page);
    await startExport(page);
    await waitForExportSuccess(page, { timeout: 90_000 });

    const outputs = await listOpfsDirectory(page, `${e2eProject.path}/_export`);
    const exportedFile = outputs.find((entry) => entry.kind === 'file');
    expect(exportedFile?.name).toMatch(/\.(mp4|webm|mkv)$/i);

    const bytes = await readFileFromOpfs(page, `${e2eProject.path}/_export/${exportedFile!.name}`);
    expect(bytes.byteLength).toBeGreaterThan(0);
  });
});
