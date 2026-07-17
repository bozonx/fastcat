import { describe, it, expect } from 'vitest';
import {
  validateTransitionIn,
  validateTransitionOut,
} from '~/utils/timeline/transition-validation';
import type { TimelineTrack, TimelineMediaClipItem } from '~/timeline/types';

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
    timelineRange: { startTicks: 0, durationTicks: 10_000_000 },
    sourceRange: { startTicks: 0, durationTicks: 5_000_000 },
    sourceDurationTicks: 10_000_000,
    source: { path: 'test.mp4' },
    speed: 1,
    isImage: false,
    ...overrides,
  } as TimelineMediaClipItem;

  return {
    ...clip,
    timelineRange: {
      startTicks: clip.timelineRange.startTicks * 254_016,
      durationTicks: clip.timelineRange.durationTicks * 254_016,
    },
    sourceRange: {
      startTicks: clip.sourceRange.startTicks * 254_016,
      durationTicks: clip.sourceRange.durationTicks * 254_016,
    },
    sourceDurationTicks: (clip.sourceDurationTicks ?? 0) * 254_016,
    transitionIn: clip.transitionIn && {
      ...clip.transitionIn,
      durationTicks: clip.transitionIn.durationTicks * 254_016,
    },
    transitionOut: clip.transitionOut && {
      ...clip.transitionOut,
      durationTicks: clip.transitionOut.durationTicks * 254_016,
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
      const clip = createClip({ transitionIn: { durationTicks: 2_000_000, mode: 'background' } });
      const track = createTrack([clip]);
      expect(validateTransitionIn(track, track.items[0] as TimelineMediaClipItem)).toBeNull();
    });

    it('returns null for transparent mode', () => {
      const clip = createClip({ transitionIn: { durationTicks: 2_000_000, mode: 'transparent' } });
      const track = createTrack([clip]);
      expect(validateTransitionIn(track, track.items[0] as TimelineMediaClipItem)).toBeNull();
    });

    it('returns error when clip is shorter than transition duration', () => {
      const clip = createClip({
        timelineRange: { startTicks: 0, durationTicks: 1_000_000 },
        transitionIn: { durationTicks: 2_000_000, mode: 'adjacent' },
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
      const clip = createClip({ transitionIn: { durationTicks: 1_000_000, mode: 'adjacent' } });
      const track = createTrack([clip]);
      const result = validateTransitionIn(track, track.items[0] as TimelineMediaClipItem);
      expect(result).not.toBeNull();
      expect(result!.key).toBe('fastcat.timeline.transition.errorNoPreviousClip');
    });

    it('returns error when gap between clips is too large', () => {
      const prev = createClip({
        id: 'prev',
        timelineRange: { startTicks: 0, durationTicks: 1_000_000 },
      });
      const curr = createClip({
        id: 'curr',
        timelineRange: { startTicks: 3_000_000, durationTicks: 10_000_000 },
        transitionIn: { durationTicks: 1_000_000, mode: 'adjacent' },
      });
      const track = createTrack([prev, curr]);
      const result = validateTransitionIn(track, track.items[1] as TimelineMediaClipItem);
      expect(result).not.toBeNull();
      expect(result!.key).toBe('fastcat.timeline.transition.errorGapBetweenClips');
      expect(result!.params).toEqual({ gapSeconds: '2.00' });
    });

    it('rejects an adjacent transition when clips are separated by one tick', () => {
      const prev = createClip({
        id: 'prev',
        timelineRange: { startTicks: 0, durationTicks: 1_000_000 },
      });
      const curr = createClip({
        id: 'curr',
        timelineRange: { startTicks: 1_000_000, durationTicks: 10_000_000 },
        transitionIn: { durationTicks: 1_000_000, mode: 'adjacent' },
      });
      curr.timelineRange.startTicks += 1;

      const result = validateTransitionIn(createTrack([prev, curr]), curr);
      expect(result?.key).toBe('fastcat.timeline.transition.errorGapBetweenClips');
    });

    it('returns error when previous clip handle is too short', () => {
      const prev = createClip({
        id: 'prev',
        timelineRange: { startTicks: 0, durationTicks: 5_000_000 },
        sourceDurationTicks: 6_000_000,
        sourceRange: { startTicks: 0, durationTicks: 5_000_000 },
      });
      const curr = createClip({
        id: 'curr',
        timelineRange: { startTicks: 5_000_000, durationTicks: 10_000_000 },
        transitionIn: { durationTicks: 2_000_000, mode: 'adjacent' },
      });
      const track = createTrack([prev, curr]);
      const result = validateTransitionIn(track, track.items[1] as TimelineMediaClipItem);
      expect(result).not.toBeNull();
      expect(result!.key).toBe('fastcat.timeline.transition.errorPrevHandleTooShort');
    });

    it('returns null for valid adjacent transition', () => {
      const prev = createClip({
        id: 'prev',
        timelineRange: { startTicks: 0, durationTicks: 5_000_000 },
        sourceDurationTicks: 10_000_000,
        sourceRange: { startTicks: 0, durationTicks: 5_000_000 },
      });
      const curr = createClip({
        id: 'curr',
        timelineRange: { startTicks: 5_000_000, durationTicks: 10_000_000 },
        transitionIn: { durationTicks: 1_000_000, mode: 'adjacent' },
      });
      const track = createTrack([prev, curr]);
      expect(validateTransitionIn(track, track.items[1] as TimelineMediaClipItem)).toBeNull();
    });

    it('returns error when transitionIn and transitionOut together exceed the clip', () => {
      const prev = createClip({
        id: 'prev',
        timelineRange: { startTicks: 0, durationTicks: 5_000_000 },
        sourceDurationTicks: 20_000_000,
        sourceRange: { startTicks: 0, durationTicks: 5_000_000 },
      });
      const curr = createClip({
        id: 'curr',
        timelineRange: { startTicks: 5_000_000, durationTicks: 4_000_000 },
        transitionIn: { durationTicks: 3_000_000, mode: 'adjacent' },
        transitionOut: { durationTicks: 3_000_000, mode: 'background' },
      });
      const track = createTrack([prev, curr]);
      const result = validateTransitionIn(track, track.items[1] as TimelineMediaClipItem);
      expect(result).not.toBeNull();
      expect(result!.key).toBe('fastcat.timeline.transition.errorClipTooShortForBoth');
      expect(result!.params).toEqual({ need: '6.00', have: '4.00' });
    });
  });

  describe('validateTransitionOut', () => {
    it('returns null when there is no transition', () => {
      const track = createTrack([createClip()]);
      expect(validateTransitionOut(track, track.items[0] as TimelineMediaClipItem)).toBeNull();
    });

    it('returns null for background mode', () => {
      const clip = createClip({ transitionOut: { durationTicks: 2_000_000, mode: 'background' } });
      const track = createTrack([clip]);
      expect(validateTransitionOut(track, track.items[0] as TimelineMediaClipItem)).toBeNull();
    });

    it('returns null for transparent mode', () => {
      const clip = createClip({ transitionOut: { durationTicks: 2_000_000, mode: 'transparent' } });
      const track = createTrack([clip]);
      expect(validateTransitionOut(track, track.items[0] as TimelineMediaClipItem)).toBeNull();
    });

    it('returns error when clip is shorter than transition duration', () => {
      const clip = createClip({
        timelineRange: { startTicks: 0, durationTicks: 1_000_000 },
        transitionOut: { durationTicks: 2_000_000, mode: 'adjacent' },
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
      const clip = createClip({ transitionOut: { durationTicks: 1_000_000, mode: 'adjacent' } });
      const track = createTrack([clip]);
      const result = validateTransitionOut(track, track.items[0] as TimelineMediaClipItem);
      expect(result).not.toBeNull();
      expect(result!.key).toBe('fastcat.timeline.transition.errorNoNextClip');
    });

    it('returns error when gap between clips is too large', () => {
      const curr = createClip({
        id: 'curr',
        timelineRange: { startTicks: 0, durationTicks: 10_000_000 },
        transitionOut: { durationTicks: 1_000_000, mode: 'adjacent' },
      });
      const next = createClip({
        id: 'next',
        timelineRange: { startTicks: 13_000_000, durationTicks: 5_000_000 },
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
        timelineRange: { startTicks: 0, durationTicks: 10_000_000 },
        transitionOut: { durationTicks: 2_000_000, mode: 'adjacent' },
      });
      const next = createClip({
        id: 'next',
        timelineRange: { startTicks: 10_000_000, durationTicks: 5_000_000 },
        sourceDurationTicks: 6_000_000,
        sourceRange: { startTicks: 0, durationTicks: 5_000_000 },
      });
      const track = createTrack([curr, next]);
      const result = validateTransitionOut(track, track.items[0] as TimelineMediaClipItem);
      expect(result).not.toBeNull();
      expect(result!.key).toBe('fastcat.timeline.transition.errorNextHandleTooShort');
    });

    it('returns null for valid adjacent transition', () => {
      const curr = createClip({
        id: 'curr',
        timelineRange: { startTicks: 0, durationTicks: 10_000_000 },
        transitionOut: { durationTicks: 1_000_000, mode: 'adjacent' },
      });
      const next = createClip({
        id: 'next',
        timelineRange: { startTicks: 10_000_000, durationTicks: 5_000_000 },
        sourceDurationTicks: 10_000_000,
        sourceRange: { startTicks: 2_000_000, durationTicks: 5_000_000 },
      });
      const track = createTrack([curr, next]);
      expect(validateTransitionOut(track, track.items[0] as TimelineMediaClipItem)).toBeNull();
    });

    it('returns error when transitionOut and transitionIn together exceed the clip', () => {
      const curr = createClip({
        id: 'curr',
        timelineRange: { startTicks: 0, durationTicks: 4_000_000 },
        transitionIn: { durationTicks: 3_000_000, mode: 'background' },
        transitionOut: { durationTicks: 3_000_000, mode: 'adjacent' },
      });
      const next = createClip({
        id: 'next',
        timelineRange: { startTicks: 4_000_000, durationTicks: 5_000_000 },
        sourceDurationTicks: 20_000_000,
        sourceRange: { startTicks: 5_000_000, durationTicks: 5_000_000 },
      });
      const track = createTrack([curr, next]);
      const result = validateTransitionOut(track, track.items[0] as TimelineMediaClipItem);
      expect(result).not.toBeNull();
      expect(result!.key).toBe('fastcat.timeline.transition.errorClipTooShortForBoth');
      expect(result!.params).toEqual({ need: '6.00', have: '4.00' });
    });
  });
});
