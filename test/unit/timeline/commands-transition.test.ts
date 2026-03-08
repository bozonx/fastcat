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
      mode: 'fade',
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
      mode: 'fade',
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
      mode: 'transition',
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

  it('keeps opposite transition unchanged when adding a new transition on the same clip', () => {
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
    expect(nextClip.transitionIn.durationUs).toBe(4_000_000);
    expect(nextClip.transitionOut.durationUs).toBe(3_000_000);
  });

  it('keeps existing overlap geometry unchanged when editing the target transition only', () => {
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

    // Simulate dragging transitionIn of right clip to 3s (growing by 1s)
    const next = applyTimelineCommand(doc, {
      type: 'update_clip_transition',
      trackId: 'v1',
      itemId: 'c2',
      transitionIn: { type: 'dissolve', durationUs: 3_000_000 },
    }).next;

    const items = (next.tracks[0] as TimelineTrack).items as any[];
    const nextLeft = items.find((it) => it.id === 'c1');
    const nextRight = items.find((it) => it.id === 'c2');

    const overlapUs =
      nextLeft.timelineRange.startUs +
      nextLeft.timelineRange.durationUs -
      nextRight.timelineRange.startUs;
    expect(overlapUs).toBe(2_000_000);
    expect(nextLeft.transitionOut.durationUs).toBe(2_000_000);
    expect(nextRight.transitionIn.durationUs).toBe(3_000_000);
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
      mode: 'transition',
      curve: 'linear',
      params: {
        direction: 'up',
        gap: 0.025,
        gapColor: '#ff00ff',
      },
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
      mode: 'transition',
      curve: 'linear',
      params: {
        blur: 0.2,
        direction: 'from-center',
      },
    });
  });
});
