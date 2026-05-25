import { describe, expect, it } from 'vitest';

import {
  clipSupportsAudioControls,
  clipSupportsSpeedControls,
  clipSupportsThumbnailControls,
  isClipFrameAligned,
} from '~/utils/timeline/clip-capabilities';

describe('clip-capabilities', () => {
  describe('isClipFrameAligned', () => {
    it('treats both edges on frame boundaries as aligned', () => {
      const clip = { timelineRange: { startUs: 0, durationUs: 1_000_000 } };
      expect(isClipFrameAligned(clip, 30)).toBe(true);
    });

    it('reports a sub-frame start offset as not aligned', () => {
      const clip = { timelineRange: { startUs: 5_333, durationUs: 1_000_000 } };
      expect(isClipFrameAligned(clip, 30)).toBe(false);
    });

    it('reports a sub-frame duration as not aligned', () => {
      // 1_010_000us at 30fps is 30.3 frames — clearly off a frame boundary.
      const clip = { timelineRange: { startUs: 0, durationUs: 1_010_000 } };
      expect(isClipFrameAligned(clip, 30)).toBe(false);
    });
  });

  describe('control predicates', () => {
    it('allows audio controls for audio tracks regardless of clip type', () => {
      expect(
        clipSupportsAudioControls(
          { kind: 'audio' },
          { clipType: 'media', isImage: false, audioFromVideoDisabled: false },
        ),
      ).toBe(true);
    });

    it('denies audio controls for image clips on video tracks', () => {
      expect(
        clipSupportsAudioControls(
          { kind: 'video' },
          { clipType: 'media', isImage: true, audioFromVideoDisabled: false },
        ),
      ).toBe(false);
    });

    it('denies speed controls for image clips on video tracks', () => {
      expect(
        clipSupportsSpeedControls({ kind: 'video' }, { clipType: 'media', isImage: true }),
      ).toBe(false);
    });

    it('allows thumbnails for media and nested timeline clips on video tracks', () => {
      expect(clipSupportsThumbnailControls({ kind: 'video' }, { clipType: 'media' })).toBe(true);
      expect(clipSupportsThumbnailControls({ kind: 'video' }, { clipType: 'timeline' })).toBe(true);
      expect(clipSupportsThumbnailControls({ kind: 'audio' }, { clipType: 'media' })).toBe(false);
    });
  });
});
