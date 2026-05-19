/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_VIDEO_FORMAT,
  DEFAULT_VIDEO_CODEC,
  DEFAULT_VIDEO_BITRATE_MBPS,
  DEFAULT_AUDIO_CODEC,
  DEFAULT_AUDIO_BITRATE_KBPS,
  DEFAULT_KEYFRAME_INTERVAL_SEC,
  DEFAULT_VIDEO_WIDTH,
  DEFAULT_VIDEO_HEIGHT,
  DEFAULT_VIDEO_FPS,
  DEFAULT_AUDIO_ONLY_FORMAT,
  DEFAULT_IMAGE_QUALITY,
  AUDIO_ONLY_EXPORT_PLACEHOLDER_DIMENSION,
  AUDIO_ONLY_EXPORT_PLACEHOLDER_FPS,
  MAX_CANVAS_DIMENSION,
} from '~/utils/conversion/constants';

describe('conversion constants', () => {
  it('exports expected default values', () => {
    expect(DEFAULT_VIDEO_FORMAT).toBe('mp4');
    expect(DEFAULT_VIDEO_CODEC).toBe('avc1.640032');
    expect(DEFAULT_VIDEO_BITRATE_MBPS).toBe(5);
    expect(DEFAULT_AUDIO_CODEC).toBe('aac');
    expect(DEFAULT_AUDIO_BITRATE_KBPS).toBe(128);
    expect(DEFAULT_KEYFRAME_INTERVAL_SEC).toBe(2);
    expect(DEFAULT_VIDEO_WIDTH).toBe(1920);
    expect(DEFAULT_VIDEO_HEIGHT).toBe(1080);
    expect(DEFAULT_VIDEO_FPS).toBe(30);
    expect(DEFAULT_AUDIO_ONLY_FORMAT).toBe('opus');
    expect(DEFAULT_IMAGE_QUALITY).toBe(80);
    expect(AUDIO_ONLY_EXPORT_PLACEHOLDER_DIMENSION).toBe(16);
    expect(AUDIO_ONLY_EXPORT_PLACEHOLDER_FPS).toBe(1);
    expect(MAX_CANVAS_DIMENSION).toBe(16384);
  });
});
