/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { timelineUs } from '../utils/timeline-time';
import { applyTimelineCommand } from '~/timeline/commands';
import type { TimelineDocument, TimelineTrack, TimelineClipItem } from '~/timeline/types';
import { isClipFrameAligned } from '~/utils/timeline/clip-capabilities';

// 30fps: one frame is 1e6/30 ≈ 33333.33µs, so these µs values sit deliberately
// *between* frame boundaries — the "free" (sub-frame) phase a hand-dialed audio
// sync produces. Structural edits must preserve this phase for audio clips and
// must never introduce it for video clips.
const FPS = 30;
const FREE_START_US = timelineUs(2_007_000); // ~frame 60.21
const FREE_DURATION_US = timelineUs(3_457_000); // ~103.71 frames
const FREE_END_US = FREE_START_US + FREE_DURATION_US;

function makeDoc(tracks: TimelineTrack[]): TimelineDocument {
  return {
    OTIO_SCHEMA: 'Timeline.1',
    id: 'doc1',
    name: 'Test',
    timebase: { fps: FPS },
    tracks,
  };
}

function audioClip(overrides: Partial<TimelineClipItem> = {}): TimelineClipItem {
  return {
    kind: 'clip',
    clipType: 'media',
    id: 'a1',
    trackId: 'a1t',
    name: 'Audio',
    source: { path: 'sound.wav' },
    sourceDurationUs: timelineUs(60_000_000),
    isImage: false,
    timelineRange: { startUs: FREE_START_US, durationUs: FREE_DURATION_US },
    sourceRange: { startUs: 0, durationUs: FREE_DURATION_US },
    ...overrides,
  } as TimelineClipItem;
}

function audioTrack(items: TimelineClipItem[]): TimelineTrack {
  return { id: 'a1t', kind: 'audio', name: 'A1', items };
}

function videoTrack(items: TimelineClipItem[]): TimelineTrack {
  return { id: 'v1t', kind: 'video', name: 'V1', items };
}

function clipsOf(doc: TimelineDocument, trackId: string): TimelineClipItem[] {
  const track = doc.tracks.find((t) => t.id === trackId);
  return (track?.items.filter((it) => it.kind === 'clip') as TimelineClipItem[]) ?? [];
}

describe('free (sub-frame) audio clip phase preservation', () => {
  it('sanity: the fixture clip is genuinely off the frame grid', () => {
    expect(isClipFrameAligned(audioClip(), FPS)).toBe(false);
  });

  describe('split_item', () => {
    it('preserves both outer edges of a free audio clip (only the cut is quantized)', () => {
      const doc = makeDoc([audioTrack([audioClip()])]);

      const { next } = applyTimelineCommand(doc, {
        type: 'split_item',
        trackId: 'a1t',
        itemId: 'a1',
        atUs: timelineUs(3_000_000), // already a frame boundary (frame 90)
      });

      const clips = clipsOf(next, 'a1t').sort(
        (a, b) => a.timelineRange.startUs - b.timelineRange.startUs,
      );
      expect(clips.length).toBe(2);
      const [left, right] = clips;

      // Outer boundaries are untouched — the sync survives.
      expect(left!.timelineRange.startUs).toBe(FREE_START_US);
      expect(right!.timelineRange.startUs + right!.timelineRange.durationUs).toBe(FREE_END_US);
      // The two halves are contiguous around the (frame-aligned) cut.
      expect(right!.timelineRange.startUs).toBe(
        left!.timelineRange.startUs + left!.timelineRange.durationUs,
      );
      expect(right!.timelineRange.startUs).toBe(timelineUs(3_000_000));
    });

    it('cuts a free audio clip at an exact sub-frame point when quantize is disabled', () => {
      const doc = makeDoc([audioTrack([audioClip()])]);
      const cutUs = timelineUs(2_500_123); // sub-frame

      const { next } = applyTimelineCommand(doc, {
        type: 'split_item',
        trackId: 'a1t',
        itemId: 'a1',
        atUs: cutUs,
        quantizeToFrames: false,
      });

      const clips = clipsOf(next, 'a1t').sort(
        (a, b) => a.timelineRange.startUs - b.timelineRange.startUs,
      );
      expect(clips.length).toBe(2);
      const [left, right] = clips;
      expect(left!.timelineRange.startUs).toBe(FREE_START_US);
      expect(right!.timelineRange.startUs).toBe(cutUs);
      expect(right!.timelineRange.startUs + right!.timelineRange.durationUs).toBe(FREE_END_US);
    });

    it('keeps a video clip frame-aligned through a split', () => {
      const alignedStart = timelineUs(2_000_000);
      const alignedDuration = timelineUs(4_000_000);
      const doc = makeDoc([
        videoTrack([
          audioClip({
            id: 'v1',
            trackId: 'v1t',
            source: { path: 'clip.mp4' },
            timelineRange: { startUs: alignedStart, durationUs: alignedDuration },
            sourceRange: { startUs: 0, durationUs: alignedDuration },
          }),
        ]),
      ]);

      const { next } = applyTimelineCommand(doc, {
        type: 'split_item',
        trackId: 'v1t',
        itemId: 'v1',
        atUs: timelineUs(3_000_000),
      });

      for (const clip of clipsOf(next, 'v1t')) {
        expect(isClipFrameAligned(clip, FPS)).toBe(true);
      }
    });
  });

  describe('move_item', () => {
    it('applies a sub-frame start verbatim when quantize is disabled', () => {
      const doc = makeDoc([audioTrack([audioClip()])]);
      const newStartUs = timelineUs(2_507_000); // sub-frame

      const { next } = applyTimelineCommand(doc, {
        type: 'move_item',
        trackId: 'a1t',
        itemId: 'a1',
        startUs: newStartUs,
        quantizeToFrames: false,
      });

      expect(clipsOf(next, 'a1t')[0]!.timelineRange.startUs).toBe(newStartUs);
    });

    it('applies a sub-frame start verbatim under preserveItemOffsets (drag commit path)', () => {
      const doc = makeDoc([audioTrack([audioClip()])]);
      const newStartUs = timelineUs(2_507_000);

      const { next } = applyTimelineCommand(doc, {
        type: 'move_items',
        moves: [{ fromTrackId: 'a1t', toTrackId: 'a1t', itemId: 'a1', startUs: newStartUs }],
        quantizeToFrames: true,
        preserveItemOffsets: true,
      });

      expect(clipsOf(next, 'a1t')[0]!.timelineRange.startUs).toBe(newStartUs);
    });

    it('quantizes a video clip start to the grid', () => {
      const doc = makeDoc([
        videoTrack([
          audioClip({
            id: 'v1',
            trackId: 'v1t',
            source: { path: 'clip.mp4' },
            timelineRange: { startUs: timelineUs(2_000_000), durationUs: timelineUs(4_000_000) },
            sourceRange: { startUs: 0, durationUs: timelineUs(4_000_000) },
          }),
        ]),
      ]);

      const { next } = applyTimelineCommand(doc, {
        type: 'move_item',
        trackId: 'v1t',
        itemId: 'v1',
        startUs: timelineUs(2_507_000), // sub-frame request
        quantizeToFrames: true,
      });

      expect(isClipFrameAligned(clipsOf(next, 'v1t')[0]!, FPS)).toBe(true);
    });
  });

  describe('trim_item', () => {
    it('preserves a sub-frame duration when trimming the end with quantize disabled', () => {
      const doc = makeDoc([audioTrack([audioClip()])]);
      const deltaUs = -timelineUs(123_000); // shrink by a sub-frame amount

      const { next } = applyTimelineCommand(doc, {
        type: 'trim_item',
        trackId: 'a1t',
        itemId: 'a1',
        edge: 'end',
        deltaUs,
        quantizeToFrames: false,
      });

      const clip = clipsOf(next, 'a1t')[0]!;
      expect(clip.timelineRange.startUs).toBe(FREE_START_US);
      expect(clip.timelineRange.durationUs).toBe(FREE_DURATION_US + deltaUs);
    });

    it('preserves the untrimmed edge phase of a free clip even in snap mode (quantize on)', () => {
      const doc = makeDoc([audioTrack([audioClip()])]);
      const deltaUs = -timelineUs(123_000); // sub-frame request; quantized to whole frames

      const { next } = applyTimelineCommand(doc, {
        type: 'trim_item',
        trackId: 'a1t',
        itemId: 'a1',
        edge: 'end',
        deltaUs,
        quantizeToFrames: true,
      });

      const clip = clipsOf(next, 'a1t')[0]!;
      // The untrimmed start (the sync anchor) is untouched — NOT re-gridded.
      expect(clip.timelineRange.startUs).toBe(FREE_START_US);
      // The clip stays free, and the end moved by a whole number of frames.
      expect(isClipFrameAligned(clip, FPS)).toBe(false);
      const durationDeltaFrames = ((clip.timelineRange.durationUs - FREE_DURATION_US) * FPS) / 1e6;
      expect(Math.abs(durationDeltaFrames - Math.round(durationDeltaFrames))).toBeLessThan(0.001);
    });

    it('quantizes a video clip end to the grid when trimming', () => {
      const doc = makeDoc([
        videoTrack([
          audioClip({
            id: 'v1',
            trackId: 'v1t',
            source: { path: 'clip.mp4' },
            timelineRange: { startUs: timelineUs(2_000_000), durationUs: timelineUs(4_000_000) },
            sourceRange: { startUs: 0, durationUs: timelineUs(4_000_000) },
          }),
        ]),
      ]);

      const { next } = applyTimelineCommand(doc, {
        type: 'trim_item',
        trackId: 'v1t',
        itemId: 'v1',
        edge: 'end',
        deltaUs: -timelineUs(123_000),
        quantizeToFrames: true,
      });

      expect(isClipFrameAligned(clipsOf(next, 'v1t')[0]!, FPS)).toBe(true);
    });
  });

  describe('add_clip_to_track (paste)', () => {
    it('preserves a free clip start and duration when quantize is disabled', () => {
      const doc = makeDoc([audioTrack([])]);

      const { next } = applyTimelineCommand(doc, {
        type: 'add_clip_to_track',
        trackId: 'a1t',
        clipId: 'paste1',
        name: 'Pasted',
        path: 'sound.wav',
        startUs: FREE_START_US,
        durationUs: FREE_DURATION_US,
        sourceDurationUs: timelineUs(60_000_000),
        sourceRange: { startUs: 0, durationUs: FREE_DURATION_US },
        isImage: false,
        quantizeToFrames: false,
      });

      const clip = clipsOf(next, 'a1t').find((c) => c.id === 'paste1')!;
      expect(clip.timelineRange.startUs).toBe(FREE_START_US);
      expect(clip.timelineRange.durationUs).toBe(FREE_DURATION_US);
      expect(isClipFrameAligned(clip, FPS)).toBe(false);
    });

    it('quantizes a pasted clip to the grid by default', () => {
      const doc = makeDoc([audioTrack([])]);

      const { next } = applyTimelineCommand(doc, {
        type: 'add_clip_to_track',
        trackId: 'a1t',
        clipId: 'paste1',
        name: 'Pasted',
        path: 'sound.wav',
        startUs: FREE_START_US,
        durationUs: FREE_DURATION_US,
        sourceDurationUs: timelineUs(60_000_000),
        sourceRange: { startUs: 0, durationUs: FREE_DURATION_US },
        isImage: false,
      });

      const clip = clipsOf(next, 'a1t').find((c) => c.id === 'paste1')!;
      expect(isClipFrameAligned(clip, FPS)).toBe(true);
    });
  });
});
