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

describe('timeline/commands add_virtual_clip_to_track (text)', () => {
  it('adds a text clip to a video track with defaults', () => {
    const doc = makeDoc({
      id: 'v1',
      kind: 'video',
      name: 'V1',
      items: [],
    });

    const next = applyTimelineCommand(doc, {
      type: 'add_virtual_clip_to_track',
      trackId: 'v1',
      clipType: 'text',
      name: 'Text',
      durationUs: 5_000_000,
      startUs: 0,
    }).next;

    const track = next.tracks[0]!;
    const clip = track.items.find((it: any) => it.kind === 'clip') as any;

    expect(clip).toBeTruthy();
    expect(clip.clipType).toBe('text');
    expect(typeof clip.text).toBe('string');
    expect(clip.text.length).toBeGreaterThan(0);
  });

  it('respects provided text and style', () => {
    const doc = makeDoc({
      id: 'v1',
      kind: 'video',
      name: 'V1',
      items: [],
    });

    const next = applyTimelineCommand(doc, {
      type: 'add_virtual_clip_to_track',
      trackId: 'v1',
      clipType: 'text',
      name: 'Title',
      durationUs: 5_000_000,
      startUs: 0,
      text: 'Hello',
      style: { fontSize: 80, color: '#ff0000', align: 'left' },
    }).next;

    const clip = (next.tracks[0] as any).items.find((it: any) => it.kind === 'clip') as any;
    expect(clip.clipType).toBe('text');
    expect(clip.text).toBe('Hello');
    expect(clip.style).toEqual({ fontSize: 80, color: '#ff0000', align: 'left' });
  });
});
