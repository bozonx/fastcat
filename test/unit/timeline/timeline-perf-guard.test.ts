/** @vitest-environment node */
/**
 * Performance guard for the pure timeline command reducer on large timelines.
 *
 * These are NOT micro-benchmarks — the budgets are deliberately generous so the
 * suite stays green on slow/loaded CI. Their job is to catch *algorithmic*
 * regressions: a single edit that turns an O(n) operation into O(n²) will blow
 * past these budgets by orders of magnitude even on a fast machine, while
 * normal variance stays comfortably under them.
 *
 * Motivated by a documented interaction-lag regression where per-command cost
 * scaled with the TOTAL number of clips on the timeline.
 */
import { describe, it, expect } from 'vitest';
import { applyTimelineCommand } from '~/timeline/commands';
import type { TimelineCommand } from '~/timeline/commands';
import {
  selectAllItems,
  selectTimelineDurationUs,
  selectItemToTrackMap,
} from '~/timeline/selectors';
import type { TimelineDocument, TimelineTrack, TimelineClipItem } from '~/timeline/types';

const FPS = 30;
const CLIP_DUR = 1_000_000;

/** Build a timeline with `tracks` tracks, each holding `perTrack` back-to-back clips. */
function makeLargeDoc(tracks: number, perTrack: number): TimelineDocument {
  const trackList: TimelineTrack[] = [];
  for (let t = 0; t < tracks; t++) {
    const items: TimelineClipItem[] = [];
    for (let i = 0; i < perTrack; i++) {
      items.push({
        kind: 'clip',
        clipType: 'media',
        id: `t${t}-c${i}`,
        trackId: `t${t}`,
        name: `clip ${t}-${i}`,
        source: { path: `t${t}-c${i}.mp4` },
        sourceDurationUs: 60_000_000,
        timelineRange: { startUs: i * CLIP_DUR, durationUs: CLIP_DUR },
        sourceRange: { startUs: 0, durationUs: CLIP_DUR },
      } as TimelineClipItem);
    }
    trackList.push({ id: `t${t}`, kind: t % 4 === 3 ? 'audio' : 'video', name: `T${t}`, items });
  }
  return {
    OTIO_SCHEMA: 'Timeline.1',
    id: 'perf-doc',
    name: 'Perf Doc',
    timebase: { fps: FPS },
    tracks: trackList,
  };
}

/** Run `fn` `iters` times and return the best (minimum) wall-clock time in ms. */
function bestOf(iters: number, fn: () => void): number {
  let best = Infinity;
  for (let i = 0; i < iters; i++) {
    const start = performance.now();
    fn();
    const elapsed = performance.now() - start;
    if (elapsed < best) best = elapsed;
  }
  return best;
}

const TRACKS = 4;
const PER_TRACK = 1000; // 4000 clips total

describe('timeline reducer performance guard (large timeline)', () => {
  it('applies a single edit command on a 4000-clip timeline well under budget', () => {
    const doc = makeLargeDoc(TRACKS, PER_TRACK);

    // Append a clip to the end of the first track (no overlap).
    const addCmd: TimelineCommand = {
      type: 'add_clip_to_track',
      trackId: 't0',
      name: 'appended',
      path: 'appended.mp4',
      startUs: PER_TRACK * CLIP_DUR,
      durationUs: CLIP_DUR,
      sourceDurationUs: 60_000_000,
    };
    const moveCmd: TimelineCommand = {
      type: 'move_item',
      trackId: 't0',
      itemId: 't0-c500',
      startUs: 500 * CLIP_DUR, // same slot -> valid, exercises the full rebuild
    };
    const splitCmd: TimelineCommand = {
      type: 'split_item',
      trackId: 't0',
      itemId: 't0-c500',
      atUs: 500 * CLIP_DUR + CLIP_DUR / 2,
    };
    const trimCmd: TimelineCommand = {
      type: 'trim_item',
      trackId: 't0',
      itemId: 't0-c0',
      edge: 'end',
      deltaUs: -100_000,
    };

    const addMs = bestOf(5, () => void applyTimelineCommand(doc, addCmd));
    const moveMs = bestOf(5, () => void applyTimelineCommand(doc, moveCmd));
    const splitMs = bestOf(5, () => void applyTimelineCommand(doc, splitCmd));
    const trimMs = bestOf(5, () => void applyTimelineCommand(doc, trimCmd));

    // A single linear pass over 4000 clips is sub-millisecond on real hardware;
    // 150ms leaves ~100x headroom while still catching an O(n^2) blowup
    // (which would land in the seconds range at this size).
    expect(addMs).toBeLessThan(150);
    expect(moveMs).toBeLessThan(150);
    expect(splitMs).toBeLessThan(150);
    expect(trimMs).toBeLessThan(150);
  });

  it('selectors over a 4000-clip timeline are cheap on a cold document', () => {
    // Fresh doc per iteration so the WeakMap selector caches never warm up —
    // this measures the actual O(n) build cost, not the cached fast path.
    const build = () => makeLargeDoc(TRACKS, PER_TRACK);

    const ms = bestOf(5, () => {
      const doc = build();
      selectAllItems(doc);
      selectTimelineDurationUs(doc);
      selectItemToTrackMap(doc);
    });

    // Includes the document construction itself; generous but O(n²)-catching.
    expect(ms).toBeLessThan(200);
  });

  it('scales roughly linearly, not quadratically, with clip count', () => {
    const small = makeLargeDoc(TRACKS, 500); // 2000 clips
    const large = makeLargeDoc(TRACKS, 2000); // 8000 clips (4x)

    const cmdFor = (perTrack: number): TimelineCommand => ({
      type: 'move_item',
      trackId: 't0',
      itemId: `t0-c${Math.floor(perTrack / 2)}`,
      startUs: Math.floor(perTrack / 2) * CLIP_DUR,
    });

    const smallMs = bestOf(8, () => void applyTimelineCommand(small, cmdFor(500)));
    const largeMs = bestOf(8, () => void applyTimelineCommand(large, cmdFor(2000)));

    // 4x the clips. Linear work would be ~4x time; quadratic would be ~16x.
    // Guard at 10x to absorb constant-factor noise while still failing loudly
    // on a genuine complexity regression. Floor the baseline to avoid dividing
    // by a near-zero timing on very fast machines.
    const ratio = largeMs / Math.max(smallMs, 0.05);
    expect(ratio).toBeLessThan(10);
  });
});
