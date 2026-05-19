/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { useFileConversionSettings } from '~/composables/file-conversion/useFileConversionSettings';

describe('useFileConversionSettings', () => {
  it('returns default video settings', () => {
    const settings = useFileConversionSettings();
    expect(settings.video.format).toBe('mp4');
    expect(settings.video.excludeAudio).toBe(false);
    expect(settings.video.bitrateMode).toBe('variable');
    expect(settings.video.resolutionFormat).toBe('1080p');
    expect(settings.video.orientation).toBe('landscape');
    expect(settings.video.aspectRatio).toBe('16:9');
    expect(settings.video.isCustomResolution).toBe(false);
  });

  it('returns default audio settings', () => {
    const settings = useFileConversionSettings();
    expect(settings.audio.channels).toBe(2);
    expect(settings.audio.sampleRate).toBe(0);
    expect(settings.audio.reverse).toBe(false);
    expect(settings.audio.originalSampleRate).toBeNull();
    expect(settings.audio.originalChannels).toBeNull();
  });

  it('returns default image settings', () => {
    const settings = useFileConversionSettings();
    expect(settings.image.width).toBe(0);
    expect(settings.image.height).toBe(0);
    expect(settings.image.isResolutionLinked).toBe(true);
    expect(settings.image.aspectRatio).toBe(1);
  });

  it('video settings are reactive', () => {
    const settings = useFileConversionSettings();
    settings.video.format = 'webm';
    expect(settings.video.format).toBe('webm');
  });
});
