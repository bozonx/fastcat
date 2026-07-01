import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeFileToOpfs } from '../../utils/e2e/virtual-fs';

const MEDIA_DIR = resolve(process.cwd(), 'test/fixtures/media');

interface ProbeResult {
  ok: boolean;
  mediaType: string;
  videoCanDecode?: boolean;
  audioCanDecode?: boolean;
  imageCanDisplay?: boolean;
  width?: number;
  height?: number;
  durationSec?: number;
  videoCodec?: string;
  audioCodec?: string;
  error?: string;
}

/**
 * Expected outcome of the real web import path (`extractMetadata` → mediabunny
 * demux / createImageBitmap) for each advertised format. This measures *ingest*
 * (can the web engine parse the container / rasterize the image), which — unlike
 * actual codec decode — does not depend on the browser's proprietary-codec
 * licensing, so it is stable in CI:
 *   - 'video'        : container demuxed, dimensions + duration reported
 *   - 'audio'        : container demuxed, codec + duration reported
 *   - 'video-reject' : web cannot demux this container (routes through native /
 *                      conversion on import) — locked so the limitation is visible
 *   - 'display'      : createImageBitmap rasterizes it
 *   - 'no-display'   : not directly displayable by the web renderer (needs convert)
 */
type WebExpectation = 'video' | 'audio' | 'video-reject' | 'display' | 'no-display';

const FIXTURES: Array<{ rel: string; type: 'video' | 'audio' | 'image'; web: WebExpectation }> = [
  { rel: 'video/video-h264-aac.mp4', type: 'video', web: 'video' },
  { rel: 'video/video-h264-aac.mov', type: 'video', web: 'video' },
  { rel: 'video/video-h264-aac.m4v', type: 'video', web: 'video' },
  // mediabunny (ALL_FORMATS) has no AVI demuxer — web import must fall back to
  // native/conversion. Locked so a silent regression (or fix) is noticed.
  { rel: 'video/video-mpeg4-mp3.avi', type: 'video', web: 'video-reject' },
  { rel: 'video/video-vp9-opus.webm', type: 'video', web: 'video' },
  { rel: 'video/video-vp8-vorbis.webm', type: 'video', web: 'video' },
  { rel: 'video/video-av1-opus.mkv', type: 'video', web: 'video' },
  { rel: 'video/video-prores.mov', type: 'video', web: 'video' },
  { rel: 'video/video-alpha-vp9.webm', type: 'video', web: 'video' },
  { rel: 'audio/audio-sine.mp3', type: 'audio', web: 'audio' },
  { rel: 'audio/audio-sine.wav', type: 'audio', web: 'audio' },
  { rel: 'audio/audio-sine.aac', type: 'audio', web: 'audio' },
  { rel: 'audio/audio-sine.flac', type: 'audio', web: 'audio' },
  { rel: 'audio/audio-sine.ogg', type: 'audio', web: 'audio' },
  { rel: 'audio/audio-sine.opus', type: 'audio', web: 'audio' },
  { rel: 'audio/audio-sine.m4a', type: 'audio', web: 'audio' },
  { rel: 'audio/audio-sine.weba', type: 'audio', web: 'audio' },
  { rel: 'image/image.jpg', type: 'image', web: 'display' },
  { rel: 'image/image-rgba.png', type: 'image', web: 'display' },
  { rel: 'image/image-animated.gif', type: 'image', web: 'display' },
  { rel: 'image/image.webp', type: 'image', web: 'display' },
  { rel: 'image/image.avif', type: 'image', web: 'display' },
  { rel: 'image/image.bmp', type: 'image', web: 'display' },
  // SVG (needs intrinsic sizing for createImageBitmap) and TIFF (non-native)
  // are not directly rasterizable by the web renderer.
  { rel: 'image/image.svg', type: 'image', web: 'no-display' },
  { rel: 'image/image.tiff', type: 'image', web: 'no-display' },
];

const basename = (rel: string): string => rel.split('/').pop()!;

test.describe('Web media format import', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Web decode requires Chromium');

  test('probes every advertised import format', async ({ page }) => {
    await page.goto('/test/media-probe');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(
      () => typeof (window as unknown as { __mediaProbe?: unknown }).__mediaProbe !== 'undefined',
    );

    const results: Array<{ rel: string; type: string; web: WebExpectation; r: ProbeResult }> = [];

    for (const { rel, type, web } of FIXTURES) {
      const filename = basename(rel);
      const opfsPath = `probe-media/${rel}`;
      const bytes = readFileSync(resolve(MEDIA_DIR, rel));
      await writeFileToOpfs(page, { path: opfsPath, data: new Uint8Array(bytes) });

      const r = (await page.evaluate(
        async ({ p, f }) => {
          const probe = (
            window as unknown as {
              __mediaProbe: { probe: (p: string, f: string) => Promise<ProbeResult> };
            }
          ).__mediaProbe.probe;
          return probe(p, f);
        },
        { p: opfsPath, f: filename },
      )) as ProbeResult;

      results.push({ rel, type, web, r });
    }

    for (const { rel, type, web, r } of results) {
      expect(r, `${rel} returned no result`).toBeTruthy();
      expect(r.mediaType, `${rel} media type`).toBe(type);

      switch (web) {
        case 'video':
          expect(r.error, `${rel} should demux without error (got: ${r.error})`).toBeUndefined();
          expect(r.width ?? 0, `${rel} should report width`).toBeGreaterThan(0);
          expect(r.height ?? 0, `${rel} should report height`).toBeGreaterThan(0);
          expect(r.durationSec ?? 0, `${rel} should report duration`).toBeGreaterThan(0);
          break;
        case 'audio':
          expect(r.error, `${rel} should demux without error (got: ${r.error})`).toBeUndefined();
          expect(r.durationSec ?? 0, `${rel} should report duration`).toBeGreaterThan(0);
          expect(r.audioCodec, `${rel} should report an audio codec`).toBeTruthy();
          break;
        case 'video-reject':
          // The web engine cannot ingest this container on its own.
          expect(r.error, `${rel} is expected to be web-unsupported (native/convert)`).toBeTruthy();
          break;
        case 'display':
          expect(r.imageCanDisplay, `${rel} should be displayable in Chromium`).toBe(true);
          expect(r.width ?? 0, `${rel} should report width`).toBeGreaterThan(0);
          expect(r.height ?? 0, `${rel} should report height`).toBeGreaterThan(0);
          break;
        case 'no-display':
          expect(r.imageCanDisplay, `${rel} should report not-directly-displayable`).toBe(false);
          break;
      }
    }
  });
});
