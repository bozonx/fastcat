/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import {
  BASE_VIDEO_CODEC_OPTIONS,
  BASE_AUDIO_CODEC_OPTIONS,
  checkVideoCodecSupport,
  checkAudioCodecSupport,
  checkAudioDecoderSupport,
  resolveVideoCodecOptions,
  resolveAudioCodecOptions,
} from '~/utils/webcodecs';

describe('webcodecs', () => {
  it('exports base codec options', () => {
    expect(BASE_VIDEO_CODEC_OPTIONS.length).toBeGreaterThan(0);
    expect(BASE_AUDIO_CODEC_OPTIONS.length).toBeGreaterThan(0);
  });

  it('returns empty object when VideoEncoder is unavailable', async () => {
    const result = await checkVideoCodecSupport(BASE_VIDEO_CODEC_OPTIONS);
    expect(result).toEqual({});
  });

  it('returns empty object when AudioEncoder is unavailable', async () => {
    const result = await checkAudioCodecSupport(BASE_AUDIO_CODEC_OPTIONS);
    expect(result).toEqual({});
  });

  it('returns empty object when AudioDecoder is unavailable', async () => {
    const result = await checkAudioDecoderSupport(BASE_AUDIO_CODEC_OPTIONS);
    expect(result).toEqual({});
  });

  it('resolves video codec options with disabled flag', () => {
    const resolved = resolveVideoCodecOptions(BASE_VIDEO_CODEC_OPTIONS, { 'avc1.640032': false });
    expect(resolved.find((o) => o.value === 'avc1.640032')!.disabled).toBe(true);
    expect(resolved.find((o) => o.value !== 'avc1.640032')!.disabled).toBe(false);
  });

  it('resolves audio codec options with disabled flag', () => {
    const resolved = resolveAudioCodecOptions(BASE_AUDIO_CODEC_OPTIONS, { opus: true, aac: false });
    expect(resolved.find((o) => o.value === 'aac')!.disabled).toBe(true);
    expect(resolved.find((o) => o.value === 'opus')!.disabled).toBe(false);
  });
});
