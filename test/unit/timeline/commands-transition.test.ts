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
    expect(clip.transitionOut).toEqual({ type: 'dissolve', durationUs: 500_000 });
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
    expect(clip.transitionIn).toEqual({ type: 'dissolve', durationUs: 300_000 });
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
});
