import { describe, expect, it } from 'vitest';

import {
  clipSupportsAudioControls,
  clipSupportsReverseControls,
  clipSupportsSpeedControls,
  clipSupportsThumbnailControls,
  isClipFrameAligned,
} from '~/utils/timeline/clip-capabilities';
import { TICKS_PER_SECOND } from '~/utils/time';

describe('clip-capabilities', () => {
  describe('isClipFrameAligned', () => {
    it('treats both edges on frame boundaries as aligned', () => {
      const clip = { timelineRange: { startUs: 0, durationUs: TICKS_PER_SECOND } };
      expect(isClipFrameAligned(clip, 30)).toBe(true);
    });

    it('reports a sub-frame start offset as not aligned', () => {
      const clip = { timelineRange: { startUs: 1, durationUs: TICKS_PER_SECOND } };
      expect(isClipFrameAligned(clip, 30)).toBe(false);
    });

    it('reports a sub-frame duration as not aligned', () => {
      const clip = { timelineRange: { startUs: 0, durationUs: TICKS_PER_SECOND + 1 } };
      expect(isClipFrameAligned(clip, 30)).toBe(false);
    });
  });

  describe('control predicates', () => {
    it('allows audio controls for audio tracks regardless of clip type', () => {
      expect(
        clipSupportsAudioControls({ kind: 'audio' }, { clipType: 'media', isImage: false }),
      ).toBe(true);
    });

    it('denies audio controls for image clips on video tracks', () => {
      expect(
        clipSupportsAudioControls({ kind: 'video' }, { clipType: 'media', isImage: true }),
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

    it('allows reverse controls only for video clips with speed support', () => {
      expect(
        clipSupportsReverseControls({ kind: 'video' }, { clipType: 'media', isImage: false }),
      ).toBe(true);
      expect(
        clipSupportsReverseControls({ kind: 'audio' }, { clipType: 'media', isImage: false }),
      ).toBe(false);
      expect(
        clipSupportsReverseControls({ kind: 'video' }, { clipType: 'media', isImage: true }),
      ).toBe(false);
    });
  });
});
