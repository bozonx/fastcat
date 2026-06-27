import { describe, it, expect } from 'vitest';
import { detectProjectFormat } from '~/utils/projectMediaDetection';

describe('detectProjectFormat', () => {
  it('should detect landscape 1080p 16:9 video format', () => {
    const format = detectProjectFormat(1920, 1080);
    expect(format).toEqual({
      width: 1920,
      height: 1080,
      orientation: 'landscape',
      aspectRatio: '16:9',
      resolutionFormat: '1080p',
    });
  });

  it('should detect portrait 1080p 16:9 video format (9:16 portrait)', () => {
    const format = detectProjectFormat(1080, 1920);
    expect(format).toEqual({
      width: 1080,
      height: 1920,
      orientation: 'portrait',
      aspectRatio: '16:9',
      resolutionFormat: '1080p',
    });
  });

  it('should detect 1:1 square video format as 1080p', () => {
    const format = detectProjectFormat(1080, 1080);
    expect(format).toEqual({
      width: 1080,
      height: 1080,
      orientation: 'landscape', // 1:1 fits landscape base logic
      aspectRatio: '1:1',
      resolutionFormat: '1080p',
    });
  });

  it('should detect landscape 720p 16:9 video format', () => {
    const format = detectProjectFormat(1280, 720);
    expect(format).toEqual({
      width: 1280,
      height: 720,
      orientation: 'landscape',
      aspectRatio: '16:9',
      resolutionFormat: '720p',
    });
  });

  it('should detect landscape 4k 16:9 video format', () => {
    const format = detectProjectFormat(3840, 2160);
    expect(format).toEqual({
      width: 3840,
      height: 2160,
      orientation: 'landscape',
      aspectRatio: '16:9',
      resolutionFormat: '4k',
    });
  });

  it('should snap non-standard resolutions to closest aspect ratios', () => {
    // 1000x1020 is very close to 1:1
    const format1 = detectProjectFormat(1000, 1020);
    expect(format1.aspectRatio).toBe('1:1');

    // 1920x1000 is closer to 16:9 than to other formats
    const format2 = detectProjectFormat(1920, 1000);
    expect(format2.aspectRatio).toBe('16:9');
  });
});
