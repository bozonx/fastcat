/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  resolveExportCodecs,
  supportsExportAlpha,
  resolveAudioExportSampleRate,
} from '~/composables/timeline/export/codecUtils';

describe('resolveExportCodecs', () => {
  it('returns vp9+opus for webm', () => {
    const result = resolveExportCodecs('webm', 'avc1.640032', 'aac');
    expect(result).toEqual({ videoCodec: 'vp09.00.10.08', audioCodec: 'opus' });
  });

  it('returns selected video codec for mkv when allowed', () => {
    const result = resolveExportCodecs('mkv', 'vp09.00.10.08', 'opus');
    expect(result).toEqual({ videoCodec: 'vp09.00.10.08', audioCodec: 'opus' });
  });

  it('falls back to av01 for mkv when codec not allowed', () => {
    const result = resolveExportCodecs('mkv', 'invalid-codec', 'aac');
    expect(result).toEqual({ videoCodec: 'av01.0.05M.08', audioCodec: 'aac' });
  });

  it('returns avc1 for mp4', () => {
    const result = resolveExportCodecs('mp4', 'vp09.00.10.08', 'aac');
    expect(result).toEqual({ videoCodec: 'avc1.640032', audioCodec: 'aac' });
  });

  it('converts flac to aac for mp4', () => {
    const result = resolveExportCodecs('mp4', 'avc1.640032', 'flac');
    expect(result.audioCodec).toBe('aac');
  });

  it('converts pcm to aac for mp4', () => {
    const result = resolveExportCodecs('mp4', 'avc1.640032', 'pcm');
    expect(result.audioCodec).toBe('aac');
  });

  it('keeps mp3 for mp4', () => {
    const result = resolveExportCodecs('mp4', 'avc1.640032', 'mp3');
    expect(result.audioCodec).toBe('mp3');
  });
});

describe('supportsExportAlpha', () => {
  it('returns true for webm', () => {
    expect(supportsExportAlpha('webm')).toBe(true);
  });

  it('returns true for mkv with vp9 codec', () => {
    expect(supportsExportAlpha('mkv', 'vp09.00.10.08')).toBe(true);
  });

  it('returns false for mkv with non-vp9 codec', () => {
    expect(supportsExportAlpha('mkv', 'avc1.640032')).toBe(false);
  });

  it('returns false for mp4', () => {
    expect(supportsExportAlpha('mp4')).toBe(false);
  });

  it('returns false for unknown format', () => {
    expect(supportsExportAlpha('avi')).toBe(false);
  });
});

describe('resolveAudioExportSampleRate', () => {
  it('returns 48000 for opus codec', () => {
    expect(resolveAudioExportSampleRate({ format: 'mp4', audioCodec: 'opus' })).toBe(48000);
  });

  it('returns 48000 for opus format', () => {
    expect(resolveAudioExportSampleRate({ format: 'opus' })).toBe(48000);
  });

  it('returns 48000 for ogg format', () => {
    expect(resolveAudioExportSampleRate({ format: 'ogg' })).toBe(48000);
  });

  it('returns 48000 for webm format', () => {
    expect(resolveAudioExportSampleRate({ format: 'webm' })).toBe(48000);
  });

  it('returns requested sample rate for non-opus formats', () => {
    expect(resolveAudioExportSampleRate({ format: 'mp4', audioCodec: 'aac', sampleRate: 44100 })).toBe(44100);
  });

  it('clamps to min 8000', () => {
    expect(resolveAudioExportSampleRate({ format: 'mp4', audioCodec: 'aac', sampleRate: 100 })).toBe(8000);
  });

  it('clamps to max 192000', () => {
    expect(resolveAudioExportSampleRate({ format: 'mp4', audioCodec: 'aac', sampleRate: 999999 })).toBe(192000);
  });

  it('returns 48000 when sampleRate is not finite', () => {
    expect(resolveAudioExportSampleRate({ format: 'mp4', audioCodec: 'aac', sampleRate: NaN })).toBe(48000);
  });

  it('returns 48000 when sampleRate is undefined', () => {
    expect(resolveAudioExportSampleRate({ format: 'mp4', audioCodec: 'aac' })).toBe(48000);
  });
});
