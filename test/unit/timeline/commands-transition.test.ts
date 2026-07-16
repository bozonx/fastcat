/** @vitest-environment node */
import { describe, it, expect, beforeAll } from 'vitest';
import { applyTimelineCommand } from '~/timeline/commands';
import type { TimelineDocument, TimelineTrack } from '~/timeline/types';
import { initTransitions } from '~/transitions';
import { timelineTicks } from '../utils/timeline-time';

beforeAll(() => {
  initTransitions();
});

function makeDoc(track: TimelineTrack): TimelineDocument {
  return {
    OTIO_SCHEMA: 'Timeline.1',
    id: 'doc1',
    name: 'Test',
    timebase: { fps: 30 },
    tracks: [track],
  };
}

const baseClip = {
  kind: 'clip' as const,
  id: 'c1',
  trackId: 'v1',
  name: 'C1',
  clipType: 'media' as const,
  source: { path: 'a.mp4' },
  sourceDurationTicks: timelineTicks(10_000_000),
  timelineRange: { startTicks: 0, durationTicks: timelineTicks(5_000_000) },
  sourceRange: { startTicks: 0, durationTicks: timelineTicks(5_000_000) },
};

describe('timeline/commands update_clip_transition', () => {
  it('sets transitionOut on a clip', () => {
    const doc = makeDoc({ id: 'v1', kind: 'video', name: 'V1', items: [baseClip] });

    const next = applyTimelineCommand(doc, {
      type: 'update_clip_transition',
      trackId: 'v1',
      itemId: 'c1',
      transitionOut: { type: 'dissolve', durationTicks: timelineTicks(500_000) },
    }).next;

    const clip = (next.tracks[0] as TimelineTrack).items[0] as any;
    expect(clip.transitionOut).toEqual({
      type: 'dissolve',
      durationTicks: timelineTicks(500_000),
      mode: 'transparent',
      curve: 'linear',
      params: {},
      isOverridden: undefined,
    });
    expect(clip.transitionIn).toBeUndefined();
  });

  it('sets transitionIn on a clip', () => {
    const doc = makeDoc({ id: 'v1', kind: 'video', name: 'V1', items: [baseClip] });

    const next = applyTimelineCommand(doc, {
      type: 'update_clip_transition',
      trackId: 'v1',
      itemId: 'c1',
      transitionIn: { type: 'dissolve', durationTicks: timelineTicks(300_000) },
    }).next;

    const clip = (next.tracks[0] as TimelineTrack).items[0] as any;
    expect(clip.transitionIn).toEqual({
      type: 'dissolve',
      durationTicks: timelineTicks(300_000),
      mode: 'transparent',
      curve: 'linear',
      params: {},
      isOverridden: undefined,
    });
  });

  it('removes transitionOut when set to null', () => {
    const clipWithTransition = {
      ...baseClip,
      transitionOut: { type: 'dissolve', durationTicks: timelineTicks(500_000) },
    };
    const doc = makeDoc({ id: 'v1', kind: 'video', name: 'V1', items: [clipWithTransition] });

    const next = applyTimelineCommand(doc, {
      type: 'update_clip_transition',
      trackId: 'v1',
      itemId: 'c1',
      transitionOut: null,
    }).next;

    const clip = (next.tracks[0] as TimelineTrack).items[0] as any;
    expect(clip.transitionOut).toBeUndefined();
  });

  it('does not modify unrelated clips', () => {
    const otherClip = {
      ...baseClip,
      id: 'c2',
      timelineRange: {
        startTicks: timelineTicks(5_000_000),
        durationTicks: timelineTicks(5_000_000),
      },
      sourceRange: { startTicks: 0, durationTicks: timelineTicks(5_000_000) },
    };
    const doc = makeDoc({ id: 'v1', kind: 'video', name: 'V1', items: [baseClip, otherClip] });

    const next = applyTimelineCommand(doc, {
      type: 'update_clip_transition',
      trackId: 'v1',
      itemId: 'c1',
      transitionOut: { type: 'dissolve', durationTicks: timelineTicks(500_000) },
    }).next;

    const clips = (next.tracks[0] as TimelineTrack).items as any[];
    const c2 = clips.find((c) => c.id === 'c2');
    expect(c2?.transitionOut).toBeUndefined();
  });

  it('returns unchanged doc for missing item', () => {
    const doc = makeDoc({ id: 'v1', kind: 'video', name: 'V1', items: [baseClip] });

    const next = applyTimelineCommand(doc, {
      type: 'update_clip_transition',
      trackId: 'v1',
      itemId: 'nonexistent',
      transitionOut: { type: 'dissolve', durationTicks: timelineTicks(500_000) },
    }).next;

    expect(next).toBe(doc);
  });

  it('keeps clip geometry unchanged and does not mirror to adjacent clip when setting transitionOut on a cut', () => {
    const left = {
      ...baseClip,
      id: 'c1',
      trackId: 'v1',
      sourceDurationTicks: timelineTicks(10_000_000),
      sourceRange: { startTicks: 0, durationTicks: timelineTicks(5_000_000) },
      timelineRange: { startTicks: 0, durationTicks: timelineTicks(5_000_000) },
    };
    const right = {
      ...baseClip,
      id: 'c2',
      trackId: 'v1',
      sourceDurationTicks: timelineTicks(10_000_000),
      sourceRange: {
        startTicks: timelineTicks(2_000_000),
        durationTicks: timelineTicks(5_000_000),
      },
      timelineRange: {
        startTicks: timelineTicks(5_000_000),
        durationTicks: timelineTicks(5_000_000),
      },
    };

    const doc = makeDoc({ id: 'v1', kind: 'video', name: 'V1', items: [left, right] as any });

    const next = applyTimelineCommand(doc, {
      type: 'update_clip_transition',
      trackId: 'v1',
      itemId: 'c1',
      transitionOut: { type: 'dissolve', durationTicks: timelineTicks(2_000_000) },
    }).next;

    const items = (next.tracks[0] as TimelineTrack).items as any[];
    const nextLeft = items.find((it) => it.id === 'c1');
    const nextRight = items.find((it) => it.id === 'c2');

    expect(nextLeft.timelineRange.durationTicks).toBe(timelineTicks(5_000_000));
    expect(nextRight.timelineRange.startTicks).toBe(timelineTicks(5_000_000));
    expect(nextRight.timelineRange.durationTicks).toBe(timelineTicks(5_000_000));
    expect(nextLeft.transitionOut).toEqual({
      type: 'dissolve',
      durationTicks: timelineTicks(2_000_000),
      mode: 'adjacent',
      curve: 'linear',
      params: {},
    });
    expect(nextRight.transitionIn).toBeUndefined();
  });

  it('updates only the target clip when changing transition duration on a cut', () => {
    const left = {
      ...baseClip,
      id: 'c1',
      trackId: 'v1',
      sourceDurationTicks: timelineTicks(10_000_000),
      sourceRange: { startTicks: 0, durationTicks: timelineTicks(7_000_000) },
      timelineRange: { startTicks: 0, durationTicks: timelineTicks(7_000_000) },
      transitionOut: { type: 'dissolve', durationTicks: timelineTicks(2_000_000) },
    };
    const right = {
      ...baseClip,
      id: 'c2',
      trackId: 'v1',
      sourceDurationTicks: timelineTicks(10_000_000),
      sourceRange: {
        startTicks: timelineTicks(2_000_000),
        durationTicks: timelineTicks(5_000_000),
      },
      timelineRange: {
        startTicks: timelineTicks(5_000_000),
        durationTicks: timelineTicks(5_000_000),
      },
      transitionIn: { type: 'dissolve', durationTicks: timelineTicks(2_000_000) },
    };

    const doc = makeDoc({ id: 'v1', kind: 'video', name: 'V1', items: [left, right] as any });

    const next = applyTimelineCommand(doc, {
      type: 'update_clip_transition',
      trackId: 'v1',
      itemId: 'c1',
      transitionOut: { type: 'dissolve', durationTicks: timelineTicks(2_100_000) },
    }).next;

    const items = (next.tracks[0] as TimelineTrack).items as any[];
    const nextLeft = items.find((it) => it.id === 'c1');
    const nextRight = items.find((it) => it.id === 'c2');

    expect(nextLeft.timelineRange.durationTicks).toBe(timelineTicks(7_000_000));
    expect(nextLeft.transitionOut.durationTicks).toBe(timelineTicks(2_100_000));
    expect(nextRight.transitionIn?.durationTicks).toBe(timelineTicks(2_000_000));
  });

  it('clamps the changed edge against the opposite edge without resizing it', () => {
    const clip = {
      ...baseClip,
      transitionOut: { type: 'dissolve', durationTicks: timelineTicks(3_000_000) },
    };
    const doc = makeDoc({ id: 'v1', kind: 'video', name: 'V1', items: [clip] as any });

    const next = applyTimelineCommand(doc, {
      type: 'update_clip_transition',
      trackId: 'v1',
      itemId: 'c1',
      transitionIn: { type: 'dissolve', durationTicks: timelineTicks(4_000_000) },
    }).next;

    const nextClip = (next.tracks[0] as TimelineTrack).items[0] as any;
    // transitionIn requested 4s on a 5s clip with existing 3s transitionOut →
    // clamps to (clip - opposite) = 2s. The opposite edge stays untouched
    // instead of being silently shrunk by a proportional pass.
    expect(nextClip.transitionIn.durationTicks).toBe(timelineTicks(2_000_000));
    expect(nextClip.transitionOut.durationTicks).toBe(timelineTicks(3_000_000));
    expect(nextClip.transitionIn.durationTicks + nextClip.transitionOut.durationTicks).toBe(
      timelineTicks(5_000_000),
    );
  });

  it('rejects clip overlap even when both sides have adjacent transitions', () => {
    const left = {
      ...baseClip,
      id: 'c1',
      trackId: 'v1',
      sourceDurationTicks: timelineTicks(10_000_000),
      sourceRange: { startTicks: 0, durationTicks: timelineTicks(7_000_000) },
      timelineRange: { startTicks: 0, durationTicks: timelineTicks(7_000_000) },
      transitionOut: { type: 'dissolve', durationTicks: timelineTicks(2_000_000) },
    };
    const right = {
      ...baseClip,
      id: 'c2',
      trackId: 'v1',
      sourceDurationTicks: timelineTicks(10_000_000),
      sourceRange: {
        startTicks: timelineTicks(2_000_000),
        durationTicks: timelineTicks(5_000_000),
      },
      timelineRange: {
        startTicks: timelineTicks(5_000_000),
        durationTicks: timelineTicks(5_000_000),
      },
      transitionIn: { type: 'dissolve', durationTicks: timelineTicks(2_000_000) },
    };

    const doc = makeDoc({ id: 'v1', kind: 'video', name: 'V1', items: [left, right] as any });

    expect(() =>
      applyTimelineCommand(doc, {
        type: 'move_item',
        trackId: 'v1',
        itemId: 'c2',
        startTicks: timelineTicks(4_000_000),
        quantizeToFrames: false,
      }),
    ).toThrow('Item overlaps with another item');
  });

  it('preserves normalized transition params when updating a clip transition', () => {
    const doc = makeDoc({ id: 'v1', kind: 'video', name: 'V1', items: [baseClip] });

    const next = applyTimelineCommand(doc, {
      type: 'update_clip_transition',
      trackId: 'v1',
      itemId: 'c1',
      transitionOut: {
        type: 'wipe',
        durationTicks: timelineTicks(500_000),
        params: {
          direction: 'up',
          gap: 0.025,
          gapColor: '#ff00ff',
        },
      },
    }).next;

    const clip = (next.tracks[0] as TimelineTrack).items[0] as any;
    expect(clip.transitionOut).toEqual({
      type: 'wipe',
      durationTicks: timelineTicks(500_000),
      mode: 'transparent',
      curve: 'linear',
      params: {
        direction: 'up',
        gap: 0.025,
        gapColor: '#ff00ff',
        edgeMode: 'gap',
        blur: 2,
        angle: 0,
      },
      isOverridden: undefined,
    });
  });

  it('normalizes invalid transition params to manifest defaults', () => {
    const doc = makeDoc({ id: 'v1', kind: 'video', name: 'V1', items: [baseClip] });

    const next = applyTimelineCommand(doc, {
      type: 'update_clip_transition',
      trackId: 'v1',
      itemId: 'c1',
      transitionIn: {
        type: 'circle',
        durationTicks: timelineTicks(300_000),
        params: {
          blur: 99,
          direction: 'wrong',
        } as any,
      },
    }).next;

    const clip = (next.tracks[0] as TimelineTrack).items[0] as any;
    expect(clip.transitionIn).toEqual({
      type: 'circle',
      durationTicks: timelineTicks(300_000),
      mode: 'transparent',
      curve: 'linear',
      params: {
        direction: 'from-center',
        blur: 20,
        anchor: 'center',
        blurMode: 'fixed',
        contentMode: 'reveal',
        offsetX: 0,
        offsetY: 0,
        scaleX: 100,
        scaleY: 100,
      },
      isOverridden: undefined,
    });
  });

  it('switches non-overridden transitionOut to transparent after unsnapping', () => {
    const left = {
      ...baseClip,
      id: 'c1',
      trackId: 'v1',
      timelineRange: { startTicks: 0, durationTicks: timelineTicks(5_000_000) },
      sourceRange: { startTicks: 0, durationTicks: timelineTicks(5_000_000) },
      transitionOut: {
        type: 'dissolve',
        durationTicks: timelineTicks(500_000),
        mode: 'adjacent',
      },
    };
    const right = {
      ...baseClip,
      id: 'c2',
      trackId: 'v1',
      timelineRange: {
        startTicks: timelineTicks(5_500_000),
        durationTicks: timelineTicks(5_000_000),
      },
      sourceRange: { startTicks: 0, durationTicks: timelineTicks(5_000_000) },
    };

    const doc = makeDoc({ id: 'v1', kind: 'video', name: 'V1', items: [left, right] as any });

    const next = applyTimelineCommand(doc, {
      type: 'update_clip_transition',
      trackId: 'v1',
      itemId: 'c1',
      transitionOut: left.transitionOut,
    }).next;

    const clip = (next.tracks[0] as TimelineTrack).items[0] as any;
    expect(clip.transitionOut?.mode).toBe('transparent');
    expect(clip.transitionOut?.isOverridden).toBeUndefined();
  });
});
