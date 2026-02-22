import { describe, it, expect } from 'vitest';
import {
  getExt,
  sanitizeBaseName,
  resolveExportCodecs,
} from '~/composables/timeline/useTimelineExport';

describe('useTimelineExport pure functions', () => {
  it('getExt should return correct extension', () => {
    expect(getExt('mp4')).toBe('mp4');
    expect(getExt('webm')).toBe('webm');
    expect(getExt('mkv')).toBe('mkv');
    // @ts-expect-error test fallback
    expect(getExt('unknown')).toBe('mp4');
  });

  it('sanitizeBaseName should sanitize filenames correctly', () => {
    expect(sanitizeBaseName('my video.mp4')).toBe('my_video');
    expect(sanitizeBaseName('special!@#$%^&*()chars')).toBe('special_chars');
    expect(sanitizeBaseName('___leading_and_trailing___')).toBe('leading_and_trailing');
    expect(sanitizeBaseName('multiple___underscores')).toBe('multiple_underscores');
  });

  it('resolveExportCodecs should force codecs for webm and mkv', () => {
    expect(resolveExportCodecs('webm', 'avc1.42E032', 'aac')).toEqual({
      videoCodec: 'vp09.00.10.08',
      audioCodec: 'opus',
    });

    expect(resolveExportCodecs('mkv', 'avc1.42E032', 'aac')).toEqual({
      videoCodec: 'av01.0.05M.08',
      audioCodec: 'opus',
    });

    expect(resolveExportCodecs('mp4', 'avc1.42E032', 'aac')).toEqual({
      videoCodec: 'avc1.42E032',
      audioCodec: 'aac',
    });
  });
});
