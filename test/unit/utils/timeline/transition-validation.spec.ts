import { describe, it, expect } from 'vitest';
import {
  validateTransitionIn,
  validateTransitionOut,
} from '~/utils/timeline/transition-validation';
import type { TimelineTrack, TimelineMediaClipItem } from '~/timeline/types';
import { timelineUs } from '../timeline-time';

function createTrack(items: TimelineMediaClipItem[]): TimelineTrack {
  return {
    id: 'track-1',
    kind: 'video',
    name: 'Video 1',
    items,
  };
}

function createClip(overrides: Partial<TimelineMediaClipItem> = {}): TimelineMediaClipItem {
  const clip = {
    kind: 'clip',
    clipType: 'media',
    id: 'clip-1',
    trackId: 'track-1',
    name: 'Clip',
    timelineRange: { startUs: 0, durationUs: 10_000_000 },
    sourceRange: { startUs: 0, durationUs: 5_000_000 },
    sourceDurationUs: 10_000_000,
    source: { path: 'test.mp4' },
    speed: 1,
    isImage: false,
    ...overrides,
  } as TimelineMediaClipItem;

  return {
    ...clip,
    timelineRange: {
      startUs: timelineUs(clip.timelineRange.startUs),
      durationUs: timelineUs(clip.timelineRange.durationUs),
    },
    sourceRange: {
      startUs: timelineUs(clip.sourceRange.startUs),
      durationUs: timelineUs(clip.sourceRange.durationUs),
    },
    sourceDurationUs: timelineUs(clip.sourceDurationUs ?? 0),
    transitionIn: clip.transitionIn && {
      ...clip.transitionIn,
      durationUs: timelineUs(clip.transitionIn.durationUs),
    },
    transitionOut: clip.transitionOut && {
      ...clip.transitionOut,
      durationUs: timelineUs(clip.transitionOut.durationUs),
    },
  } as TimelineMediaClipItem;
}

describe('transition-validation', () => {
  describe('validateTransitionIn', () => {
    it('returns null when there is no transition', () => {
      const track = createTrack([createClip()]);
      expect(validateTransitionIn(track, track.items[0] as TimelineMediaClipItem)).toBeNull();
    });

    it('returns null for background mode', () => {
      const clip = createClip({ transitionIn: { durationUs: 2_000_000, mode: 'background' } });
      const track = createTrack([clip]);
      expect(validateTransitionIn(track, track.items[0] as TimelineMediaClipItem)).toBeNull();
    });

    it('returns null for transparent mode', () => {
      const clip = createClip({ transitionIn: { durationUs: 2_000_000, mode: 'transparent' } });
      const track = createTrack([clip]);
      expect(validateTransitionIn(track, track.items[0] as TimelineMediaClipItem)).toBeNull();
    });

    it('returns error when clip is shorter than transition duration', () => {
      const clip = createClip({
        timelineRange: { startUs: 0, durationUs: 1_000_000 },
        transitionIn: { durationUs: 2_000_000, mode: 'adjacent' },
      });
      const track = createTrack([clip]);
      const result = validateTransitionIn(track, track.items[0] as TimelineMediaClipItem);
      expect(result).not.toBeNull();
      expect(result!.key).toBe('fastcat.timeline.transition.errorClipTooShort');
      expect(result!.params).toEqual({
        need: '2.00',
        have: '1.00',
      });
    });

    it('returns error when there is no previous clip in adjacent mode', () => {
      const clip = createClip({ transitionIn: { durationUs: 1_000_000, mode: 'adjacent' } });
      const track = createTrack([clip]);
      const result = validateTransitionIn(track, track.items[0] as TimelineMediaClipItem);
      expect(result).not.toBeNull();
      expect(result!.key).toBe('fastcat.timeline.transition.errorNoPreviousClip');
    });

    it('returns error when gap between clips is too large', () => {
      const prev = createClip({
        id: 'prev',
        timelineRange: { startUs: 0, durationUs: 1_000_000 },
      });
      const curr = createClip({
        id: 'curr',
        timelineRange: { startUs: 3_000_000, durationUs: 10_000_000 },
        transitionIn: { durationUs: 1_000_000, mode: 'adjacent' },
      });
      const track = createTrack([prev, curr]);
      const result = validateTransitionIn(track, track.items[1] as TimelineMediaClipItem);
      expect(result).not.toBeNull();
      expect(result!.key).toBe('fastcat.timeline.transition.errorGapBetweenClips');
      expect(result!.params).toEqual({ gapSeconds: '2.00' });
    });

    it('rejects an adjacent transition when clips are separated by one tick', () => {
      const prev = createClip({ id: 'prev', timelineRange: { startUs: 0, durationUs: 1_000_000 } });
      const curr = createClip({
        id: 'curr',
        timelineRange: { startUs: 1_000_000, durationUs: 10_000_000 },
        transitionIn: { durationUs: 1_000_000, mode: 'adjacent' },
      });
      curr.timelineRange.startUs += 1;

      const result = validateTransitionIn(createTrack([prev, curr]), curr);
      expect(result?.key).toBe('fastcat.timeline.transition.errorGapBetweenClips');
    });

    it('returns error when previous clip handle is too short', () => {
      const prev = createClip({
        id: 'prev',
        timelineRange: { startUs: 0, durationUs: 5_000_000 },
        sourceDurationUs: 6_000_000,
        sourceRange: { startUs: 0, durationUs: 5_000_000 },
      });
      const curr = createClip({
        id: 'curr',
        timelineRange: { startUs: 5_000_000, durationUs: 10_000_000 },
        transitionIn: { durationUs: 2_000_000, mode: 'adjacent' },
      });
      const track = createTrack([prev, curr]);
      const result = validateTransitionIn(track, track.items[1] as TimelineMediaClipItem);
      expect(result).not.toBeNull();
      expect(result!.key).toBe('fastcat.timeline.transition.errorPrevHandleTooShort');
    });

    it('returns null for valid adjacent transition', () => {
      const prev = createClip({
        id: 'prev',
        timelineRange: { startUs: 0, durationUs: 5_000_000 },
        sourceDurationUs: 10_000_000,
        sourceRange: { startUs: 0, durationUs: 5_000_000 },
      });
      const curr = createClip({
        id: 'curr',
        timelineRange: { startUs: 5_000_000, durationUs: 10_000_000 },
        transitionIn: { durationUs: 1_000_000, mode: 'adjacent' },
      });
      const track = createTrack([prev, curr]);
      expect(validateTransitionIn(track, track.items[1] as TimelineMediaClipItem)).toBeNull();
    });
  });

  describe('validateTransitionOut', () => {
    it('returns null when there is no transition', () => {
      const track = createTrack([createClip()]);
      expect(validateTransitionOut(track, track.items[0] as TimelineMediaClipItem)).toBeNull();
    });

    it('returns null for background mode', () => {
      const clip = createClip({ transitionOut: { durationUs: 2_000_000, mode: 'background' } });
      const track = createTrack([clip]);
      expect(validateTransitionOut(track, track.items[0] as TimelineMediaClipItem)).toBeNull();
    });

    it('returns null for transparent mode', () => {
      const clip = createClip({ transitionOut: { durationUs: 2_000_000, mode: 'transparent' } });
      const track = createTrack([clip]);
      expect(validateTransitionOut(track, track.items[0] as TimelineMediaClipItem)).toBeNull();
    });

    it('returns error when clip is shorter than transition duration', () => {
      const clip = createClip({
        timelineRange: { startUs: 0, durationUs: 1_000_000 },
        transitionOut: { durationUs: 2_000_000, mode: 'adjacent' },
      });
      const track = createTrack([clip]);
      const result = validateTransitionOut(track, track.items[0] as TimelineMediaClipItem);
      expect(result).not.toBeNull();
      expect(result!.key).toBe('fastcat.timeline.transition.errorClipTooShort');
      expect(result!.params).toEqual({
        need: '2.00',
        have: '1.00',
      });
    });

    it('returns error when there is no next clip in adjacent mode', () => {
      const clip = createClip({ transitionOut: { durationUs: 1_000_000, mode: 'adjacent' } });
      const track = createTrack([clip]);
      const result = validateTransitionOut(track, track.items[0] as TimelineMediaClipItem);
      expect(result).not.toBeNull();
      expect(result!.key).toBe('fastcat.timeline.transition.errorNoNextClip');
    });

    it('returns error when gap between clips is too large', () => {
      const curr = createClip({
        id: 'curr',
        timelineRange: { startUs: 0, durationUs: 10_000_000 },
        transitionOut: { durationUs: 1_000_000, mode: 'adjacent' },
      });
      const next = createClip({
        id: 'next',
        timelineRange: { startUs: 13_000_000, durationUs: 5_000_000 },
      });
      const track = createTrack([curr, next]);
      const result = validateTransitionOut(track, track.items[0] as TimelineMediaClipItem);
      expect(result).not.toBeNull();
      expect(result!.key).toBe('fastcat.timeline.transition.errorGapBetweenClips');
      expect(result!.params).toEqual({ gapSeconds: '3.00' });
    });

    it('returns error when next clip handle is too short', () => {
      const curr = createClip({
        id: 'curr',
        timelineRange: { startUs: 0, durationUs: 10_000_000 },
        transitionOut: { durationUs: 2_000_000, mode: 'adjacent' },
      });
      const next = createClip({
        id: 'next',
        timelineRange: { startUs: 10_000_000, durationUs: 5_000_000 },
        sourceDurationUs: 6_000_000,
        sourceRange: { startUs: 0, durationUs: 5_000_000 },
      });
      const track = createTrack([curr, next]);
      const result = validateTransitionOut(track, track.items[0] as TimelineMediaClipItem);
      expect(result).not.toBeNull();
      expect(result!.key).toBe('fastcat.timeline.transition.errorNextHandleTooShort');
    });

    it('returns null for valid adjacent transition', () => {
      const curr = createClip({
        id: 'curr',
        timelineRange: { startUs: 0, durationUs: 10_000_000 },
        transitionOut: { durationUs: 1_000_000, mode: 'adjacent' },
      });
      const next = createClip({
        id: 'next',
        timelineRange: { startUs: 10_000_000, durationUs: 5_000_000 },
        sourceDurationUs: 10_000_000,
        sourceRange: { startUs: 2_000_000, durationUs: 5_000_000 },
      });
      const track = createTrack([curr, next]);
      expect(validateTransitionOut(track, track.items[0] as TimelineMediaClipItem)).toBeNull();
    });
  });
});
