import { describe, it, expect } from 'vitest';
import {
  PreviewRenderOptionsSchema,
  MediaMetadataSchema,
  parseMediaMetadata,
  safeParseMediaMetadata,
} from '~/utils/video-editor/worker-rpc';

describe('PreviewRenderOptionsSchema', () => {
  it('parses valid preview render options', () => {
    const result = PreviewRenderOptionsSchema.parse({
      previewEffectsEnabled: true,
      pixiRenderer: 'webgpu',
      videoFrameCacheMb: 128,
      monitorSyncMode: 'balanced',
      previewEffectQuality: 'high',
    });

    expect(result).toEqual({
      previewEffectsEnabled: true,
      pixiRenderer: 'webgpu',
      videoFrameCacheMb: 128,
      monitorSyncMode: 'balanced',
      previewEffectQuality: 'high',
    });
  });

  it('accepts empty object (all fields optional)', () => {
    const result = PreviewRenderOptionsSchema.parse({});
    expect(result).toEqual({});
  });

  it('rejects invalid pixiRenderer', () => {
    expect(() => PreviewRenderOptionsSchema.parse({ pixiRenderer: 'invalid' })).toThrow();
  });

  it('rejects invalid monitorSyncMode', () => {
    expect(() => PreviewRenderOptionsSchema.parse({ monitorSyncMode: 'fast' })).toThrow();
  });

  it('rejects negative videoFrameCacheMb', () => {
    expect(() => PreviewRenderOptionsSchema.parse({ videoFrameCacheMb: -1 })).toThrow();
  });

  it('rejects NaN videoFrameCacheMb', () => {
    expect(() => PreviewRenderOptionsSchema.parse({ videoFrameCacheMb: NaN })).toThrow();
  });

  it('rejects invalid previewEffectQuality', () => {
    expect(() =>
      PreviewRenderOptionsSchema.parse({ previewEffectQuality: 'ultra-fast' }),
    ).toThrow();
  });

  it('accepts valid previewEffectQuality values', () => {
    for (const q of ['low', 'medium', 'high', 'ultra'] as const) {
      const result = PreviewRenderOptionsSchema.parse({ previewEffectQuality: q });
      expect(result.previewEffectQuality).toBe(q);
    }
  });
});

describe('MediaMetadataSchema', () => {
  const validMetadata = {
    source: { size: 1000, lastModified: 1234567890 },
    duration: 10.5,
    video: {
      width: 1920,
      height: 1080,
      displayWidth: 1920,
      displayHeight: 1080,
      rotation: 0,
      codec: 'avc1.42E01E',
      parsedCodec: 'avc',
      fps: 30,
    },
    audio: {
      codec: 'mp4a.40.2',
      parsedCodec: 'aac',
      sampleRate: 48000,
      channels: 2,
    },
  };

  it('parses valid metadata with video and audio', () => {
    const result = parseMediaMetadata(validMetadata);
    expect(result.duration).toBe(10.5);
    expect(result.video?.width).toBe(1920);
    expect(result.audio?.sampleRate).toBe(48000);
  });

  it('parses metadata without video and audio', () => {
    const result = parseMediaMetadata({
      source: { size: 100, lastModified: 0 },
      duration: 0,
    });
    expect(result.video).toBeUndefined();
    expect(result.audio).toBeUndefined();
  });

  it('parses metadata with image properties', () => {
    const result = parseMediaMetadata({
      source: { size: 500, lastModified: 0 },
      duration: 0,
      image: { canDisplay: true, width: 800, height: 600 },
    });
    expect(result.image?.canDisplay).toBe(true);
    expect(result.image?.width).toBe(800);
  });

  it('parses metadata with colorSpace', () => {
    const result = parseMediaMetadata({
      ...validMetadata,
      video: {
        ...validMetadata.video,
        colorSpace: { fullRange: true, matrix: 'bt709', primaries: 'bt709', transfer: 'bt709' },
      },
    });
    expect(result.video?.colorSpace?.fullRange).toBe(true);
    expect(result.video?.colorSpace?.matrix).toBe('bt709');
  });

  it('rejects metadata with negative duration', () => {
    expect(() =>
      parseMediaMetadata({ source: { size: 1, lastModified: 0 }, duration: -1 }),
    ).toThrow();
  });

  it('rejects metadata with zero sampleRate', () => {
    expect(() =>
      parseMediaMetadata({
        ...validMetadata,
        audio: { ...validMetadata.audio, sampleRate: 0 },
      }),
    ).toThrow();
  });

  it('rejects metadata with non-positive channels', () => {
    expect(() =>
      parseMediaMetadata({
        ...validMetadata,
        audio: { ...validMetadata.audio, channels: 0 },
      }),
    ).toThrow();
  });

  it('rejects metadata missing source', () => {
    expect(() => parseMediaMetadata({ duration: 1 })).toThrow();
  });

  it('rejects metadata with non-finite fps', () => {
    expect(() =>
      parseMediaMetadata({
        ...validMetadata,
        video: { ...validMetadata.video, fps: Infinity },
      }),
    ).toThrow();
  });

  it('safeParseMediaMetadata returns success for valid data', () => {
    const result = safeParseMediaMetadata(validMetadata);
    expect(result.success).toBe(true);
  });

  it('safeParseMediaMetadata returns error for invalid data', () => {
    const result = safeParseMediaMetadata({ invalid: true });
    expect(result.success).toBe(false);
  });

  it('accepts metadata with error flag', () => {
    const result = parseMediaMetadata({
      source: { size: 0, lastModified: 0 },
      duration: 0,
      error: true,
    });
    expect(result.error).toBe(true);
  });

  it('accepts optional bitrate fields', () => {
    const result = parseMediaMetadata({
      ...validMetadata,
      video: { ...validMetadata.video, bitrate: 5000000 },
      audio: { ...validMetadata.audio, bitrate: 192000 },
    });
    expect(result.video?.bitrate).toBe(5000000);
    expect(result.audio?.bitrate).toBe(192000);
  });
});
