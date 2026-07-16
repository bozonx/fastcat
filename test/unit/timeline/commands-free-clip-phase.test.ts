/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { applyTimelineCommand } from '~/timeline/commands';
import type { TimelineDocument, TimelineTrack, TimelineClipItem } from '~/timeline/types';
import { isClipFrameAligned } from '~/utils/timeline/clip-capabilities';
import { TICKS_PER_SECOND } from '~/utils/time';

// 30fps: one frame is TICKS_PER_SECOND/30 ≈ 8_467_200 ticks, so these tick values
// sit deliberately *between* frame boundaries — the "free" (sub-frame) phase a
// hand-dialed audio sync produces. Structural edits must preserve this phase for
// audio clips and must never introduce it for video clips.
const FPS = 30;
const FREE_START_TICKS = 509_810_112_000; // ~frame 60.21
const FREE_DURATION_TICKS = 878_133_312_000; // ~103.71 frames
const FREE_END_TICKS = FREE_START_TICKS + FREE_DURATION_TICKS;

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
    sourceDurationTicks: 15_240_960_000_000,
    isImage: false,
    timelineRange: { startTicks: FREE_START_TICKS, durationTicks: FREE_DURATION_TICKS },
    sourceRange: { startTicks: 0, durationTicks: FREE_DURATION_TICKS },
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
        atTicks: 762_048_000_000, // already a frame boundary (frame 90)
      });

      const clips = clipsOf(next, 'a1t').sort(
        (a, b) => a.timelineRange.startTicks - b.timelineRange.startTicks,
      );
      expect(clips.length).toBe(2);
      const [left, right] = clips;

      // Outer boundaries are untouched — the sync survives.
      expect(left!.timelineRange.startTicks).toBe(FREE_START_TICKS);
      expect(right!.timelineRange.startTicks + right!.timelineRange.durationTicks).toBe(
        FREE_END_TICKS,
      );
      // The two halves are contiguous around the (frame-aligned) cut.
      expect(right!.timelineRange.startTicks).toBe(
        left!.timelineRange.startTicks + left!.timelineRange.durationTicks,
      );
      expect(right!.timelineRange.startTicks).toBe(762_048_000_000);
    });

    it('cuts a free audio clip at an exact sub-frame point when quantize is disabled', () => {
      const doc = makeDoc([audioTrack([audioClip()])]);
      const cutTicks = 635_071_243_968; // sub-frame

      const { next } = applyTimelineCommand(doc, {
        type: 'split_item',
        trackId: 'a1t',
        itemId: 'a1',
        atTicks: cutTicks,
        quantizeToFrames: false,
      });

      const clips = clipsOf(next, 'a1t').sort(
        (a, b) => a.timelineRange.startTicks - b.timelineRange.startTicks,
      );
      expect(clips.length).toBe(2);
      const [left, right] = clips;
      expect(left!.timelineRange.startTicks).toBe(FREE_START_TICKS);
      expect(right!.timelineRange.startTicks).toBe(cutTicks);
      expect(right!.timelineRange.startTicks + right!.timelineRange.durationTicks).toBe(
        FREE_END_TICKS,
      );
    });

    it('keeps a video clip frame-aligned through a split', () => {
      const alignedStart = 508_032_000_000;
      const alignedDuration = 1_016_064_000_000;
      const doc = makeDoc([
        videoTrack([
          audioClip({
            id: 'v1',
            trackId: 'v1t',
            source: { path: 'clip.mp4' },
            timelineRange: { startTicks: alignedStart, durationTicks: alignedDuration },
            sourceRange: { startTicks: 0, durationTicks: alignedDuration },
          }),
        ]),
      ]);

      const { next } = applyTimelineCommand(doc, {
        type: 'split_item',
        trackId: 'v1t',
        itemId: 'v1',
        atTicks: 762_048_000_000,
      });

      for (const clip of clipsOf(next, 'v1t')) {
        expect(isClipFrameAligned(clip, FPS)).toBe(true);
      }
    });
  });

  describe('move_item', () => {
    it('applies a sub-frame start verbatim when quantize is disabled', () => {
      const doc = makeDoc([audioTrack([audioClip()])]);
      const newStartTicks = 636_818_112_000; // sub-frame

      const { next } = applyTimelineCommand(doc, {
        type: 'move_item',
        trackId: 'a1t',
        itemId: 'a1',
        startTicks: newStartTicks,
        quantizeToFrames: false,
      });

      expect(clipsOf(next, 'a1t')[0]!.timelineRange.startTicks).toBe(newStartTicks);
    });

    it('applies a sub-frame start verbatim under preserveItemOffsets (drag commit path)', () => {
      const doc = makeDoc([audioTrack([audioClip()])]);
      const newStartTicks = 636_818_112_000;

      const { next } = applyTimelineCommand(doc, {
        type: 'move_items',
        moves: [{ fromTrackId: 'a1t', toTrackId: 'a1t', itemId: 'a1', startTicks: newStartTicks }],
        quantizeToFrames: true,
        preserveItemOffsets: true,
      });

      expect(clipsOf(next, 'a1t')[0]!.timelineRange.startTicks).toBe(newStartTicks);
    });

    it('quantizes a video clip start to the grid', () => {
      const doc = makeDoc([
        videoTrack([
          audioClip({
            id: 'v1',
            trackId: 'v1t',
            source: { path: 'clip.mp4' },
            timelineRange: {
              startTicks: 508_032_000_000,
              durationTicks: 1_016_064_000_000,
            },
            sourceRange: { startTicks: 0, durationTicks: 1_016_064_000_000 },
          }),
        ]),
      ]);

      const { next } = applyTimelineCommand(doc, {
        type: 'move_item',
        trackId: 'v1t',
        itemId: 'v1',
        startTicks: 636_818_112_000, // sub-frame request
        quantizeToFrames: true,
      });

      expect(isClipFrameAligned(clipsOf(next, 'v1t')[0]!, FPS)).toBe(true);
    });
  });

  describe('trim_item', () => {
    it('preserves a sub-frame duration when trimming the end with quantize disabled', () => {
      const doc = makeDoc([audioTrack([audioClip()])]);
      const deltaTicks = -31_243_968_000; // shrink by a sub-frame amount

      const { next } = applyTimelineCommand(doc, {
        type: 'trim_item',
        trackId: 'a1t',
        itemId: 'a1',
        edge: 'end',
        deltaTicks,
        quantizeToFrames: false,
      });

      const clip = clipsOf(next, 'a1t')[0]!;
      expect(clip.timelineRange.startTicks).toBe(FREE_START_TICKS);
      expect(clip.timelineRange.durationTicks).toBe(FREE_DURATION_TICKS + deltaTicks);
    });

    it('preserves the untrimmed edge phase of a free clip even in snap mode (quantize on)', () => {
      const doc = makeDoc([audioTrack([audioClip()])]);
      const deltaTicks = -31_243_968_000; // sub-frame request; quantized to whole frames

      const { next } = applyTimelineCommand(doc, {
        type: 'trim_item',
        trackId: 'a1t',
        itemId: 'a1',
        edge: 'end',
        deltaTicks,
        quantizeToFrames: true,
      });

      const clip = clipsOf(next, 'a1t')[0]!;
      // The untrimmed start (the sync anchor) is untouched — NOT re-gridded.
      expect(clip.timelineRange.startTicks).toBe(FREE_START_TICKS);
      // The clip stays free, and the end moved by a whole number of frames.
      expect(isClipFrameAligned(clip, FPS)).toBe(false);
      const durationDeltaFrames =
        ((clip.timelineRange.durationTicks - FREE_DURATION_TICKS) * FPS) / TICKS_PER_SECOND;
      expect(Math.abs(durationDeltaFrames - Math.round(durationDeltaFrames))).toBeLessThan(0.001);
    });

    it('quantizes a video clip end to the grid when trimming', () => {
      const doc = makeDoc([
        videoTrack([
          audioClip({
            id: 'v1',
            trackId: 'v1t',
            source: { path: 'clip.mp4' },
            timelineRange: {
              startTicks: 508_032_000_000,
              durationTicks: 1_016_064_000_000,
            },
            sourceRange: { startTicks: 0, durationTicks: 1_016_064_000_000 },
          }),
        ]),
      ]);

      const { next } = applyTimelineCommand(doc, {
        type: 'trim_item',
        trackId: 'v1t',
        itemId: 'v1',
        edge: 'end',
        deltaTicks: -31_243_968_000,
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
        startTicks: FREE_START_TICKS,
        durationTicks: FREE_DURATION_TICKS,
        sourceDurationTicks: 15_240_960_000_000,
        sourceRange: { startTicks: 0, durationTicks: FREE_DURATION_TICKS },
        isImage: false,
        quantizeToFrames: false,
      });

      const clip = clipsOf(next, 'a1t').find((c) => c.id === 'paste1')!;
      expect(clip.timelineRange.startTicks).toBe(FREE_START_TICKS);
      expect(clip.timelineRange.durationTicks).toBe(FREE_DURATION_TICKS);
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
        startTicks: FREE_START_TICKS,
        durationTicks: FREE_DURATION_TICKS,
        sourceDurationTicks: 15_240_960_000_000,
        sourceRange: { startTicks: 0, durationTicks: FREE_DURATION_TICKS },
        isImage: false,
      });

      const clip = clipsOf(next, 'a1t').find((c) => c.id === 'paste1')!;
      expect(isClipFrameAligned(clip, FPS)).toBe(true);
    });
  });
});
