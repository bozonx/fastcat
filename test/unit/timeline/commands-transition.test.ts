import { describe, it, expect } from 'vitest';
import { applyTimelineCommand } from '~/timeline/commands';
import type { TimelineDocument, TimelineTrack } from '~/timeline/types';

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
  sourceDurationUs: 10_000_000,
  timelineRange: { startUs: 0, durationUs: 5_000_000 },
  sourceRange: { startUs: 0, durationUs: 5_000_000 },
};

describe('timeline/commands update_clip_transition', () => {
  it('sets transitionOut on a clip', () => {
    const doc = makeDoc({ id: 'v1', kind: 'video', name: 'V1', items: [baseClip] });

    const next = applyTimelineCommand(doc, {
      type: 'update_clip_transition',
      trackId: 'v1',
      itemId: 'c1',
      transitionOut: { type: 'dissolve', durationUs: 500_000 },
    }).next;

    const clip = (next.tracks[0] as TimelineTrack).items[0] as any;
    expect(clip.transitionOut).toEqual({
      type: 'dissolve',
      durationUs: 500_000,
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
      transitionIn: { type: 'dissolve', durationUs: 300_000 },
    }).next;

    const clip = (next.tracks[0] as TimelineTrack).items[0] as any;
    expect(clip.transitionIn).toEqual({
      type: 'dissolve',
      durationUs: 300_000,
      mode: 'transparent',
      curve: 'linear',
      params: {},
      isOverridden: undefined,
    });
  });

  it('removes transitionOut when set to null', () => {
    const clipWithTransition = {
      ...baseClip,
      transitionOut: { type: 'dissolve', durationUs: 500_000 },
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
      timelineRange: { startUs: 5_000_000, durationUs: 5_000_000 },
      sourceRange: { startUs: 0, durationUs: 5_000_000 },
    };
    const doc = makeDoc({ id: 'v1', kind: 'video', name: 'V1', items: [baseClip, otherClip] });

    const next = applyTimelineCommand(doc, {
      type: 'update_clip_transition',
      trackId: 'v1',
      itemId: 'c1',
      transitionOut: { type: 'dissolve', durationUs: 500_000 },
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
      transitionOut: { type: 'dissolve', durationUs: 500_000 },
    }).next;

    expect(next).toBe(doc);
  });

  it('keeps clip geometry unchanged and does not mirror to adjacent clip when setting transitionOut on a cut', () => {
    const left = {
      ...baseClip,
      id: 'c1',
      trackId: 'v1',
      sourceDurationUs: 10_000_000,
      sourceRange: { startUs: 0, durationUs: 5_000_000 },
      timelineRange: { startUs: 0, durationUs: 5_000_000 },
    };
    const right = {
      ...baseClip,
      id: 'c2',
      trackId: 'v1',
      sourceDurationUs: 10_000_000,
      sourceRange: { startUs: 2_000_000, durationUs: 5_000_000 },
      timelineRange: { startUs: 5_000_000, durationUs: 5_000_000 },
    };

    const doc = makeDoc({ id: 'v1', kind: 'video', name: 'V1', items: [left, right] as any });

    const next = applyTimelineCommand(doc, {
      type: 'update_clip_transition',
      trackId: 'v1',
      itemId: 'c1',
      transitionOut: { type: 'dissolve', durationUs: 2_000_000 },
    }).next;

    const items = (next.tracks[0] as TimelineTrack).items as any[];
    const nextLeft = items.find((it) => it.id === 'c1');
    const nextRight = items.find((it) => it.id === 'c2');

    expect(nextLeft.timelineRange.durationUs).toBe(5_000_000);
    expect(nextRight.timelineRange.startUs).toBe(5_000_000);
    expect(nextRight.timelineRange.durationUs).toBe(5_000_000);
    expect(nextLeft.transitionOut).toEqual({
      type: 'dissolve',
      durationUs: 2_000_000,
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
      sourceDurationUs: 10_000_000,
      sourceRange: { startUs: 0, durationUs: 7_000_000 },
      timelineRange: { startUs: 0, durationUs: 7_000_000 },
      transitionOut: { type: 'dissolve', durationUs: 2_000_000 },
    };
    const right = {
      ...baseClip,
      id: 'c2',
      trackId: 'v1',
      sourceDurationUs: 10_000_000,
      sourceRange: { startUs: 2_000_000, durationUs: 5_000_000 },
      timelineRange: { startUs: 5_000_000, durationUs: 5_000_000 },
      transitionIn: { type: 'dissolve', durationUs: 2_000_000 },
    };

    const doc = makeDoc({ id: 'v1', kind: 'video', name: 'V1', items: [left, right] as any });

    const next = applyTimelineCommand(doc, {
      type: 'update_clip_transition',
      trackId: 'v1',
      itemId: 'c1',
      transitionOut: { type: 'dissolve', durationUs: 2_100_000 },
    }).next;

    const items = (next.tracks[0] as TimelineTrack).items as any[];
    const nextLeft = items.find((it) => it.id === 'c1');
    const nextRight = items.find((it) => it.id === 'c2');

    expect(nextLeft.timelineRange.durationUs).toBe(7_000_000);
    expect(nextLeft.transitionOut.durationUs).toBe(2_100_000);
    expect(nextRight.transitionIn?.durationUs).toBe(2_000_000);
  });

  it('proportionally shrinks both clip transitions when they would overlap', () => {
    const clip = {
      ...baseClip,
      transitionOut: { type: 'dissolve', durationUs: 3_000_000 },
    };
    const doc = makeDoc({ id: 'v1', kind: 'video', name: 'V1', items: [clip] as any });

    const next = applyTimelineCommand(doc, {
      type: 'update_clip_transition',
      trackId: 'v1',
      itemId: 'c1',
      transitionIn: { type: 'dissolve', durationUs: 4_000_000 },
    }).next;

    const nextClip = (next.tracks[0] as TimelineTrack).items[0] as any;
    expect(nextClip.transitionIn.durationUs).toBe(2_857_143);
    expect(nextClip.transitionOut.durationUs).toBe(2_142_857);
    expect(nextClip.transitionIn.durationUs + nextClip.transitionOut.durationUs).toBe(5_000_000);
  });

  it('rejects clip overlap even when both sides have adjacent transitions', () => {
    const left = {
      ...baseClip,
      id: 'c1',
      trackId: 'v1',
      sourceDurationUs: 10_000_000,
      sourceRange: { startUs: 0, durationUs: 7_000_000 },
      timelineRange: { startUs: 0, durationUs: 7_000_000 },
      transitionOut: { type: 'dissolve', durationUs: 2_000_000 },
    };
    const right = {
      ...baseClip,
      id: 'c2',
      trackId: 'v1',
      sourceDurationUs: 10_000_000,
      sourceRange: { startUs: 2_000_000, durationUs: 5_000_000 },
      timelineRange: { startUs: 5_000_000, durationUs: 5_000_000 },
      transitionIn: { type: 'dissolve', durationUs: 2_000_000 },
    };

    const doc = makeDoc({ id: 'v1', kind: 'video', name: 'V1', items: [left, right] as any });

    expect(() =>
      applyTimelineCommand(doc, {
        type: 'move_item',
        trackId: 'v1',
        itemId: 'c2',
        startUs: 4_000_000,
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
        durationUs: 500_000,
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
      durationUs: 500_000,
      mode: 'transparent',
      curve: 'linear',
      params: {
        direction: 'up',
        gap: 0.025,
        gapColor: '#ff00ff',
        edgeMode: 'gap',
        blur: 0.02,
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
        durationUs: 300_000,
        params: {
          blur: 99,
          direction: 'wrong',
        } as any,
      },
    }).next;

    const clip = (next.tracks[0] as TimelineTrack).items[0] as any;
    expect(clip.transitionIn).toEqual({
      type: 'circle',
      durationUs: 300_000,
      mode: 'transparent',
      curve: 'linear',
      params: {
        direction: 'from-center',
        blur: 0.2,
        anchor: 'center',
        blurMode: 'fixed',
        followScale: false,
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
      timelineRange: { startUs: 0, durationUs: 5_000_000 },
      sourceRange: { startUs: 0, durationUs: 5_000_000 },
      transitionOut: {
        type: 'dissolve',
        durationUs: 500_000,
        mode: 'adjacent',
      },
    };
    const right = {
      ...baseClip,
      id: 'c2',
      trackId: 'v1',
      timelineRange: { startUs: 5_500_000, durationUs: 5_000_000 },
      sourceRange: { startUs: 0, durationUs: 5_000_000 },
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
