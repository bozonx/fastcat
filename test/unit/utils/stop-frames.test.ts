import { describe, expect, it } from 'vitest';

import {
  buildStopFrameBaseName,
  formatStopFrameTimecode,
  renderExportFrameBlob,
} from '../../../src/utils/stop-frames';

describe('stop-frames', () => {
  it('formats timecode as HH-MM-SS-FF', () => {
    expect(formatStopFrameTimecode({ timeUs: 0, fps: 30 })).toBe('00-00-00-00');
    expect(formatStopFrameTimecode({ timeUs: 1_000_000, fps: 30 })).toBe('00-00-01-00');
    expect(formatStopFrameTimecode({ timeUs: 1_500_000, fps: 30 })).toBe('00-00-01-15');
  });

  it('builds base name with sanitized timeline name and timecode', () => {
    const base = buildStopFrameBaseName({
      timelineName: 'My Timeline.otio',
      timeUs: 1_000_000,
      fps: 30,
    });

    expect(base).toBe('My_Timeline_00-00-01-00');
  });

  it('defaults to timeline base name if empty', () => {
    const base = buildStopFrameBaseName({
      timelineName: '',
      timeUs: 0,
      fps: 30,
    });

    expect(base).toBe('timeline_00-00-00-00');
  });

  it('renders export frame blob with given resolution and quality', async () => {
    const sourceCanvas: any = { width: 100, height: 50 };

    let capturedWidth = 0;
    let capturedHeight = 0;
    let capturedMime: string | undefined;
    let capturedQuality: number | undefined;
    let drawImageCalled = false;

    const mockCtx: any = {
      imageSmoothingEnabled: false,
      drawImage: (canvas: any, x: number, y: number, w: number, h: number) => {
        drawImageCalled = true;
        capturedWidth = w;
        capturedHeight = h;
      },
    };

    const mockCanvas: any = {
      width: 0,
      height: 0,
      getContext: () => mockCtx,
      toBlob: (cb: (blob: Blob | null) => void, mime?: string, quality?: number) => {
        capturedMime = mime;
        capturedQuality = quality;
        cb(new Blob(['x']));
      },
    };

    const blob = await renderExportFrameBlob({
      sourceCanvas,
      exportWidth: 1920,
      exportHeight: 1080,
      quality: 0.5,
      mimeType: 'image/webp',
      createCanvas: () => mockCanvas,
    });

    expect(blob).toBeInstanceOf(Blob);
    expect(drawImageCalled).toBe(true);
    expect(capturedWidth).toBe(1920);
    expect(capturedHeight).toBe(1080);
    expect(capturedMime).toBe('image/webp');
    expect(capturedQuality).toBeCloseTo(0.5);
  });

  it('clamps invalid resolution and throws for non-positive sizes', async () => {
    const sourceCanvas: any = { width: 100, height: 50 };

    await expect(
      renderExportFrameBlob({
        sourceCanvas,
        exportWidth: 0,
        exportHeight: 1080,
        quality: 0.8,
        createCanvas: () => ({}) as any,
      }),
    ).rejects.toThrow('Invalid export resolution');
  });
});
