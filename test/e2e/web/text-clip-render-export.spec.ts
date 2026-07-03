import { test, expect } from '../fixtures/workspace';
import {
  addTextClipAtPlayhead,
  addFileToTrack,
  getTimelineDocInfo,
  trackIds,
} from '../../utils/e2e/timeline';
import { readTimelineDoc, waitForTimelineDoc } from '../../utils/e2e/otio';
import { MEDIA_FIXTURES } from '../../fixtures/media';
import { seedProjectMedia } from '../../utils/e2e/file-manager';
import { openExport, startExport, waitForExportSuccess } from '../../utils/e2e/transport';
import { listOpfsDirectory, readFileFromOpfs } from '../../utils/e2e/virtual-fs';

test.describe('Web text clip render/export', () => {
  test.slow();

  test('renders a styled text clip in the monitor and exports it', async ({ page, e2eProject }) => {
    page.on('console', (msg) => {
      const text = msg.text();
      if (
        text.includes('[E2E addTextClip]') ||
        text.includes('[saveTimeline debug]') ||
        text.includes('[autoSave.doSave debug]') ||
        text.includes('[flushTimelineAutosave debug]') ||
        text.includes('[loadTimeline debug]')
      )
        console.log(text);
    });
    const [videoTrackId] = await trackIds(page);
    const [clipId] = await addTextClipAtPlayhead(page, {
      trackId: videoTrackId,
      durationUs: 1_000_000,
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
    console.log('DOC_INFO_AFTER_ADD_TEXT', JSON.stringify(await getTimelineDocInfo(page)));

    await waitForTimelineDoc(page, e2eProject, (doc) =>
      doc.allClips.some((clip) => clip.id === clipId),
    );
    console.log('DOC_INFO_AFTER_WAIT', JSON.stringify(await getTimelineDocInfo(page)));

    await page.getByRole('button', { name: 'Cut', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Fullscreen' })).toBeVisible({
      timeout: 20_000,
    });

    console.log('DOC_INFO_BEFORE_OPEN_EXPORT', JSON.stringify(await getTimelineDocInfo(page)));
    console.log(
      'PERSISTED_BEFORE_OPEN_EXPORT',
      JSON.stringify(await readTimelineDoc(page, e2eProject)),
    );
    await openExport(page);
    console.log('DOC_INFO_AFTER_OPEN_EXPORT', JSON.stringify(await getTimelineDocInfo(page)));
    console.log(
      'PERSISTED_AFTER_OPEN_EXPORT',
      JSON.stringify(await readTimelineDoc(page, e2eProject)),
    );
    await startExport(page);
    console.log('DOC_INFO_AFTER_START_EXPORT', JSON.stringify(await getTimelineDocInfo(page)));
    console.log(
      'PERSISTED_AFTER_START_EXPORT',
      JSON.stringify(await readTimelineDoc(page, e2eProject)),
    );
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
      durationUs: 1_000_000,
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
