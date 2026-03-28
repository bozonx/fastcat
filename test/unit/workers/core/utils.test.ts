import { describe, it, expect } from 'vitest';
import {
  normalizeRpcError,
  getBunnyVideoCodec,
  parseVideoCodec,
  parseAudioCodec,
  getBunnyAudioCodec,
  clampFloat32,
} from '~/workers/core/utils';

describe('worker core utils', () => {
  it('normalizes RPC error from various data types', () => {
    const err = normalizeRpcError({
      message: 'Custom error',
      name: 'MyError',
      stack: 'stack trace',
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Custom error');
    expect(err.name).toBe('MyError');
    expect(err.stack).toBe('stack trace');

    expect(normalizeRpcError('Simple error').message).toBe('Simple error');
    expect(normalizeRpcError(null).message).toBe('Worker RPC error');
  });

  it('correctly identifies bunny video codecs', () => {
    expect(getBunnyVideoCodec('avc1.4d401e')).toBe('avc');
    expect(getBunnyVideoCodec('hev1.1.6.L93.B0')).toBe('hevc');
    expect(getBunnyVideoCodec('hvc1.1.6.L93.B0')).toBe('hevc');
    expect(getBunnyVideoCodec('vp8')).toBe('vp8');
    expect(getBunnyVideoCodec('vp09.00.10.08')).toBe('vp9');
    expect(getBunnyVideoCodec('av01.0.01M.08')).toBe('av1');
    expect(getBunnyVideoCodec('unknown')).toBe('avc');
  });

  it('parses video codec strings into human-readable names', () => {
    expect(parseVideoCodec('avc1.4d401e')).toBe('H.264 (AVC)');
    expect(parseVideoCodec('hev1.1.6.L93.B0')).toBe('H.265 (HEVC)');
    expect(parseVideoCodec('vp09.00.10.08')).toBe('VP9');
    expect(parseVideoCodec('av01.0.01M.08')).toBe('AV1');
    expect(parseVideoCodec('custom')).toBe('custom');
  });

  it('parses audio codec strings', () => {
    expect(parseAudioCodec('mp4a.40.2')).toBe('AAC');
    expect(parseAudioCodec('opus')).toBe('Opus');
    expect(parseAudioCodec('vorbis')).toBe('Vorbis');
    expect(parseAudioCodec('pcm')).toBe('pcm');
  });

  it('maps strings to bunny audio codecs', () => {
    expect(getBunnyAudioCodec('mp4a.40.2')).toBe('aac');
    expect(getBunnyAudioCodec('aac')).toBe('aac');
    expect(getBunnyAudioCodec('opus')).toBe('opus');
    expect(getBunnyAudioCodec(undefined)).toBe('aac');
    expect(getBunnyAudioCodec('pcm-s16')).toBe('pcm-s16');
  });

  it('clamps float32 values between -1 and 1', () => {
    expect(clampFloat32(0.5)).toBe(0.5);
    expect(clampFloat32(1.5)).toBe(1);
    expect(clampFloat32(-2.5)).toBe(-1);
    expect(clampFloat32(0)).toBe(0);
  });
});
