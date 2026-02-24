import { describe, it, expect } from 'vitest';
import { applyTimelineCommand } from '~/timeline/commands';
import type { TimelineDocument } from '~/timeline/types';

function makeEmptyDoc(): TimelineDocument {
  return {
    OTIO_SCHEMA: 'Timeline.1',
    id: 'doc1',
    name: 'Test',
    timebase: { fps: 30 },
    tracks: [],
  };
}

describe('timeline/commands track addition', () => {
  it('adds video tracks to the top', () => {
    let doc = makeEmptyDoc();

    // Add first video track
    doc = applyTimelineCommand(doc, {
      type: 'add_track',
      kind: 'video',
      name: 'Video 1',
    }).next;

    expect(doc.tracks.length).toBe(1);
    expect(doc.tracks[0].name).toBe('Video 1');

    // Add second video track
    doc = applyTimelineCommand(doc, {
      type: 'add_track',
      kind: 'video',
      name: 'Video 2',
    }).next;

    expect(doc.tracks.length).toBe(2);
    expect(doc.tracks[0].name).toBe('Video 2');
    expect(doc.tracks[1].name).toBe('Video 1');
  });

  it('adds audio tracks to the bottom', () => {
    let doc = makeEmptyDoc();

    // Add first audio track
    doc = applyTimelineCommand(doc, {
      type: 'add_track',
      kind: 'audio',
      name: 'Audio 1',
    }).next;

    expect(doc.tracks.length).toBe(1);
    expect(doc.tracks[0].name).toBe('Audio 1');

    // Add second audio track
    doc = applyTimelineCommand(doc, {
      type: 'add_track',
      kind: 'audio',
      name: 'Audio 2',
    }).next;

    expect(doc.tracks.length).toBe(2);
    expect(doc.tracks[0].name).toBe('Audio 1');
    expect(doc.tracks[1].name).toBe('Audio 2');
  });

  it('preserves video-before-audio ordering with additions', () => {
    let doc = makeEmptyDoc();

    // Add Video 1
    doc = applyTimelineCommand(doc, { type: 'add_track', kind: 'video', name: 'Video 1' }).next;
    // Add Audio 1
    doc = applyTimelineCommand(doc, { type: 'add_track', kind: 'audio', name: 'Audio 1' }).next;

    // Now tracks: [Video 1, Audio 1]
    expect(doc.tracks.map((t) => t.name)).toEqual(['Video 1', 'Audio 1']);

    // Add Video 2 (should be at very top)
    doc = applyTimelineCommand(doc, { type: 'add_track', kind: 'video', name: 'Video 2' }).next;
    expect(doc.tracks.map((t) => t.name)).toEqual(['Video 2', 'Video 1', 'Audio 1']);

    // Add Audio 2 (should be at very bottom)
    doc = applyTimelineCommand(doc, { type: 'add_track', kind: 'audio', name: 'Audio 2' }).next;
    expect(doc.tracks.map((t) => t.name)).toEqual(['Video 2', 'Video 1', 'Audio 1', 'Audio 2']);
  });
});
