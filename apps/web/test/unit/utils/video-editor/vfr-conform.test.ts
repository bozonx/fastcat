/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  buildConformConversionRequest,
  buildConformFileName,
} from '~/utils/video-editor/vfr-conform';
import type { FsEntry } from '~/types/fs';
import type { MediaMetadata } from '~/types/media';

const entry = { name: 'clip.mp4', path: '/p/clip.mp4', kind: 'file' } as unknown as FsEntry;

function meta(overrides: Partial<MediaMetadata['video']> = {}, audio = true): MediaMetadata {
  return {
    source: { size: 1, lastModified: 1 },
    duration: 10,
    video: {
      width: 1920,
      height: 1080,
      displayWidth: 1920,
      displayHeight: 1080,
      rotation: 0,
      codec: 'avc1.640028',
      parsedCodec: 'h264',
      fps: 29.97,
      bitrate: 8_000_000,
      isVariableFrameRate: true,
      ...overrides,
    },
    audio: audio ? { codec: 'aac', parsedCodec: 'aac', sampleRate: 48000, channels: 2 } : undefined,
  };
}

describe('buildConformConversionRequest', () => {
  it('produces a CFR video request at the target fps, preserving resolution', () => {
    const req = buildConformConversionRequest({
      entry,
      dirPath: '/p',
      outputFileName: 'clip.cfr60.mp4',
      metadata: meta(),
      targetFps: 60,
    });
    expect(req.type).toBe('video');
    expect(req.video?.fps).toBe(60);
    expect(req.video?.width).toBe(1920);
    expect(req.video?.height).toBe(1080);
    // Source bitrate (8 Mbps) is preserved.
    expect(req.video?.bitrateMbps).toBe(8);
    expect(req.video?.excludeAudio).toBe(false);
    expect(req.sharedAudio.channels).toBe(2);
    expect(req.sharedAudio.sampleRate).toBe(48000);
  });

  it('uses displayWidth/Height (rotated sources) over coded size', () => {
    const req = buildConformConversionRequest({
      entry,
      dirPath: '/p',
      outputFileName: 'o.mp4',
      metadata: meta({ width: 1080, height: 1920, displayWidth: 1920, displayHeight: 1080 }),
      targetFps: 30,
    });
    expect(req.video?.width).toBe(1920);
    expect(req.video?.height).toBe(1080);
  });

  it('excludes audio and defaults the bitrate when the source lacks them', () => {
    const req = buildConformConversionRequest({
      entry,
      dirPath: '/p',
      outputFileName: 'o.mp4',
      metadata: meta({ bitrate: undefined }, false),
      targetFps: 30,
    });
    expect(req.video?.excludeAudio).toBe(true);
    expect(req.video?.bitrateMbps).toBeGreaterThan(0);
  });

  it('falls back to 30fps for a bogus target', () => {
    const req = buildConformConversionRequest({
      entry,
      dirPath: '/p',
      outputFileName: 'o.mp4',
      metadata: meta(),
      targetFps: 0,
    });
    expect(req.video?.fps).toBe(30);
  });
});

describe('buildConformFileName', () => {
  it('builds a self-describing cfr name', () => {
    expect(buildConformFileName('clip.mp4', 60)).toBe('clip.cfr60.mp4');
    expect(buildConformFileName('a.b.mov', 29.97)).toBe('a.b.cfr30.mp4');
    expect(buildConformFileName('', 30)).toBe('clip.cfr30.mp4');
  });
});
