import { test, expect } from '../fixtures/workspace';
import { MEDIA_FIXTURES } from '../../fixtures/media';
import { seedProjectMedia } from '../../utils/e2e/file-manager';
import {
  addFileToTrack,
  trackIds,
  clipIds,
  updateClipProperties,
  setCurrentTimeTicks,
} from '../../utils/e2e/timeline';
import { waitForTimelineDoc } from '../../utils/e2e/otio';
import { probeWebGpu } from '../../utils/e2e/webgpu';

/**
 * "Blur past edges" must let the blur bleed OUTSIDE the clip rectangle without
 * shrinking the visible content. Regression: the padded effect output was
 * contain-fit into the frame, so the picture scaled down as blur strength grew.
 */

interface ContentBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
  canvasW: number;
  canvasH: number;
  edgeEnergy: number;
}

async function measureMonitorContent(page: import('@playwright/test').Page): Promise<ContentBox> {
  return await page.evaluate(() => {
    // Locate the monitor's stage canvas: walk up from the seekbar (a stable
    // monitor-panel anchor) until an ancestor contains a canvas, then take the
    // largest one (the Pixi stage; timeline/waveform canvases live elsewhere).
    const seekbar = document.querySelector('[data-testid="monitor-seekbar"]');
    if (!seekbar) throw new Error('monitor seekbar not found');
    let scope: HTMLElement | null = seekbar as HTMLElement;
    let best: HTMLCanvasElement | null = null;
    while (scope && !best) {
      let bestArea = 0;
      for (const c of Array.from(scope.querySelectorAll('canvas'))) {
        const area = c.width * c.height;
        if (area > bestArea) {
          best = c;
          bestArea = area;
        }
      }
      scope = scope.parentElement;
    }
    if (!best) throw new Error('monitor canvas not found');

    const w = best.width;
    const h = best.height;
    const probe = document.createElement('canvas');
    probe.width = w;
    probe.height = h;
    const ctx = probe.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    ctx.drawImage(best, 0, 0);
    const data = ctx.getImageData(0, 0, w, h).data;

    const threshold = 24; // r+g+b above this counts as content (not black)
    let left = w;
    let right = -1;
    let top = h;
    let bottom = -1;
    // Horizontal gradient energy — drops sharply when the image is blurred.
    let edgeEnergy = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (data[i]! + data[i + 1]! + data[i + 2]! > threshold) {
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
        if (x + 1 < w) {
          edgeEnergy += Math.abs(data[i]! - data[i + 4]!);
        }
      }
    }
    if (right < 0) throw new Error('monitor canvas is entirely black');
    (window as unknown as { __blurProbeDataUrl?: string }).__blurProbeDataUrl =
      probe.toDataURL('image/png');
    return {
      left,
      right,
      top,
      bottom,
      width: right - left + 1,
      height: bottom - top + 1,
      canvasW: w,
      canvasH: h,
      edgeEnergy,
    };
  });
}

async function setBlurEffect(
  page: import('@playwright/test').Page,
  itemId: string,
  params: { strength: number; blurPastEdges: boolean; blurType?: string } | null,
): Promise<void> {
  await updateClipProperties(page, {
    itemId,
    properties: {
      effects:
        params === null
          ? []
          : [
              {
                id: 'e2e-blur',
                type: 'blur',
                enabled: true,
                target: 'video',
                blurType: params.blurType ?? 'gaussian',
                strength: params.strength,
                blurPastEdges: params.blurPastEdges,
                mix: 1,
              },
            ],
    },
  });
}

async function setClipScale(
  page: import('@playwright/test').Page,
  itemId: string,
  scale: number,
): Promise<void> {
  await updateClipProperties(page, {
    itemId,
    properties: {
      transformActive: true,
      transform: { scale: { x: scale, y: scale, linked: true } },
    },
  });
}

// Set BLUR_SHOT_DIR to dump the measured monitor canvas as PNGs for debugging.
async function dumpMonitorShot(page: import('@playwright/test').Page, name: string) {
  const dir = process.env.BLUR_SHOT_DIR;
  if (!dir) return;
  const dataUrl = await page.evaluate(
    () => (window as unknown as { __blurProbeDataUrl?: string }).__blurProbeDataUrl ?? '',
  );
  if (!dataUrl) return;
  const { writeFileSync, mkdirSync } = await import('node:fs');
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${name}.png`, Buffer.from(dataUrl.split(',')[1]!, 'base64'));
}

async function runScenario(
  page: import('@playwright/test').Page,
  e2eProject: Parameters<typeof seedProjectMedia>[1],
  media: { fixture: (typeof MEDIA_FIXTURES.video)['h264Mp4']; kind: 'video' | 'image' },
  shotPrefix: string,
) {
  const { uiPath } = await seedProjectMedia(page, e2eProject, media.fixture, media.kind);
  const videoTrackId = (await trackIds(page))[0];
  // The pointer-DnD drop occasionally misses right after project load; retry.
  for (let attempt = 0; attempt < 3; attempt++) {
    await addFileToTrack(page, uiPath, videoTrackId);
    try {
      await expect.poll(async () => (await clipIds(page)).length, { timeout: 5_000 }).toBe(1);
      break;
    } catch {
      // retry the drag
    }
  }
  const doc = await waitForTimelineDoc(page, e2eProject, (d) => d.allClips.length === 1);
  const itemId = (await clipIds(page))[0]!;

  // The drag may land the clip a few seconds in — park the playhead inside it.
  const clipDoc = doc.allClips[0]!;
  await setCurrentTimeTicks(page, clipDoc.timelineStartTicks + 500_000);

  const gpu = await probeWebGpu(page);
  test.skip(!gpu.available, `WebGPU unavailable: ${gpu.reason}`);

  // Baseline: no effects.
  await page.waitForTimeout(1500);
  const baseline = await measureMonitorContent(page);
  await dumpMonitorShot(page, `${shotPrefix}-baseline`);

  // Blur without bleed must keep the footprint.
  await setBlurEffect(page, itemId, { strength: 60, blurPastEdges: false });
  await page.waitForTimeout(1500);
  const noBleed = await measureMonitorContent(page);
  await dumpMonitorShot(page, `${shotPrefix}-no-bleed`);

  // Blur with bleed: content must NOT shrink (bleed goes outside the frame
  // and is clipped by the project bounds).
  await setBlurEffect(page, itemId, { strength: 60, blurPastEdges: true });
  await page.waitForTimeout(1500);
  const bleed = await measureMonitorContent(page);
  await dumpMonitorShot(page, `${shotPrefix}-bleed`);

  await setBlurEffect(page, itemId, {
    strength: 60,
    blurPastEdges: true,
    blurType: 'radial',
  });
  await page.waitForTimeout(1500);
  const radialBleed = await measureMonitorContent(page);
  await dumpMonitorShot(page, `${shotPrefix}-radial-bleed`);

  // Regression guard for the coded-vs-display frame size bug: contain-fit
  // must reach the project frame on at least one axis even before effects.
  expect(
    baseline.width >= baseline.canvasW - 2 || baseline.height >= baseline.canvasH - 2,
    `baseline content ${baseline.width}x${baseline.height} does not reach the ` +
      `${baseline.canvasW}x${baseline.canvasH} frame on either axis`,
  ).toBe(true);

  // Guard: the blur must actually be applied, otherwise the footprint
  // comparison below is vacuous (blurring cuts the gradient energy).
  expect(noBleed.edgeEnergy).toBeLessThan(baseline.edgeEnergy * 0.85);

  // The bleed halo may extend the bbox outward (into letterbox bars), but the
  // content must never SHRINK relative to the unpadded render.
  const tol = Math.max(4, Math.round(baseline.canvasW * 0.02));
  expect(Math.abs(noBleed.width - baseline.width)).toBeLessThanOrEqual(tol);
  expect(Math.abs(noBleed.height - baseline.height)).toBeLessThanOrEqual(tol);
  expect(
    baseline.width - bleed.width,
    `bleed content width ${bleed.width} vs baseline ${baseline.width} (canvas ${baseline.canvasW}x${baseline.canvasH})`,
  ).toBeLessThanOrEqual(tol);
  expect(
    baseline.height - bleed.height,
    `bleed content height ${bleed.height} vs baseline ${baseline.height}`,
  ).toBeLessThanOrEqual(tol);
  expect(baseline.width - radialBleed.width).toBeLessThanOrEqual(tol);
  expect(baseline.height - radialBleed.height).toBeLessThanOrEqual(tol);

  // Scaled-down clip: now there is background around the content, so the blur's
  // outward bleed is visible instead of being clipped by the frame. With "blur
  // past edges" ON the edge must feather OUTWARD — the content bbox must grow
  // beyond the plain (clamped-at-edge) blur, not stay a hard rectangle.
  await setClipScale(page, itemId, 0.5);
  await setBlurEffect(page, itemId, { strength: 60, blurPastEdges: false });
  await page.waitForTimeout(1500);
  const scaledNoBleed = await measureMonitorContent(page);
  await dumpMonitorShot(page, `${shotPrefix}-scaled-no-bleed`);

  await setBlurEffect(page, itemId, { strength: 60, blurPastEdges: true });
  await page.waitForTimeout(1500);
  const scaledBleed = await measureMonitorContent(page);
  await dumpMonitorShot(page, `${shotPrefix}-scaled-bleed`);

  // The bleed halo extends past the rectangle on both axes (a hard edge would
  // leave the bbox unchanged). Require a clear outward growth beyond noise.
  expect(
    scaledBleed.width - scaledNoBleed.width,
    `scaled bleed width ${scaledBleed.width} should exceed no-bleed ${scaledNoBleed.width}`,
  ).toBeGreaterThan(tol);
  expect(
    scaledBleed.height - scaledNoBleed.height,
    `scaled bleed height ${scaledBleed.height} should exceed no-bleed ${scaledNoBleed.height}`,
  ).toBeGreaterThan(tol);
}

test.describe('Blur past edges', () => {
  test('video: does not shrink the visible content', async ({ page, e2eProject }) => {
    await runScenario(
      page,
      e2eProject,
      { fixture: MEDIA_FIXTURES.video.h264Mp4, kind: 'video' },
      'blur-video',
    );
  });

  test('image: does not shrink the visible content', async ({ page, e2eProject }) => {
    await runScenario(
      page,
      e2eProject,
      { fixture: MEDIA_FIXTURES.image.jpg, kind: 'image' },
      'blur-image',
    );
  });
});
