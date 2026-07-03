import { test, expect } from '../fixtures/workspace';
import { addTextClipAtPlayhead, setCurrentTimeUs, trackIds } from '../../utils/e2e/timeline';
import { waitForTimelineDoc } from '../../utils/e2e/otio';
import { openExport, startExport, waitForExportSuccess } from '../../utils/e2e/transport';
import { listOpfsDirectory, readFileFromOpfs } from '../../utils/e2e/virtual-fs';

async function countVisibleMonitorPixels(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const seekbar = document.querySelector('[data-testid="monitor-seekbar"]');
    if (!seekbar) throw new Error('monitor seekbar not found');
    const monitorRoot = seekbar.closest('section, [data-testid], .relative') ?? document.body;
    const canvases = Array.from(monitorRoot.querySelectorAll('canvas'));
    const canvas = canvases
      .filter((item) => item.width > 0 && item.height > 0)
      .sort((a, b) => b.width * b.height - a.width * a.height)[0];
    if (!canvas) throw new Error('monitor canvas not found');

    const probe = document.createElement('canvas');
    probe.width = canvas.width;
    probe.height = canvas.height;
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2d context not available');
    ctx.drawImage(canvas, 0, 0);

    const image = ctx.getImageData(0, 0, probe.width, probe.height).data;
    let visible = 0;
    for (let i = 0; i < image.length; i += 4) {
      const r = image[i]!;
      const g = image[i + 1]!;
      const b = image[i + 2]!;
      const a = image[i + 3]!;
      if (a > 16 && (r > 40 || g > 40 || b > 40)) visible++;
    }
    return visible;
  });
}

test.describe('Web text clip render/export', () => {
  test.slow();

  test('renders a styled text clip in the monitor and exports it', async ({
    page,
    e2eProject,
  }) => {
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

    await waitForTimelineDoc(
      page,
      e2eProject,
      (doc) =>
        doc.allClips.some(
          (clip) =>
            clip.id === clipId &&
            clip.clipType === 'text' &&
            clip.style?.textShadowEnabled === true &&
            clip.style?.backgroundEnabled === true &&
            clip.style?.borderEnabled === true,
        ),
    );

    await setCurrentTimeUs(page, 500_000);
    await expect.poll(() => countVisibleMonitorPixels(page), { timeout: 20_000 }).toBeGreaterThan(200);

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
