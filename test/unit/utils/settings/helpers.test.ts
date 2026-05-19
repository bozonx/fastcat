/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { getResolutionPreset } from '~/utils/settings/helpers';

describe('getResolutionPreset', () => {
  it('detects standard 1080p landscape', () => {
    const result = getResolutionPreset(1920, 1080);
    expect(result.resolutionFormat).toBe('1080p');
    expect(result.orientation).toBe('landscape');
    expect(result.aspectRatio).toBe('16:9');
    expect(result.isCustomResolution).toBe(false);
  });

  it('detects standard 720p landscape', () => {
    const result = getResolutionPreset(1280, 720);
    expect(result.resolutionFormat).toBe('720p');
    expect(result.orientation).toBe('landscape');
  });

  it('detects 4k landscape', () => {
    const result = getResolutionPreset(3840, 2160);
    expect(result.resolutionFormat).toBe('4k');
    expect(result.orientation).toBe('landscape');
  });

  it('detects portrait orientation', () => {
    const result = getResolutionPreset(1080, 1920);
    expect(result.resolutionFormat).toBe('1080p');
    expect(result.orientation).toBe('portrait');
    expect(result.aspectRatio).toBe('16:9');
  });

  it('marks non-standard resolution as custom', () => {
    const result = getResolutionPreset(1000, 500);
    expect(result.isCustomResolution).toBe(true);
    expect(result.resolutionFormat).toBe('1080p');
  });

  it('detects 4:3 aspect ratio', () => {
    const result = getResolutionPreset(800, 600);
    expect(result.aspectRatio).toBe('4:3');
  });

  it('detects 1:1 aspect ratio', () => {
    const result = getResolutionPreset(500, 500);
    expect(result.aspectRatio).toBe('1:1');
  });

  it('detects 21:9 aspect ratio', () => {
    const result = getResolutionPreset(2100, 900);
    expect(result.aspectRatio).toBe('21:9');
  });
});
