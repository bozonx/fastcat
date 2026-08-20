/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { planForwardChunkPlayback } from '~/utils/video-editor/audio-seam-plan';

const OVERLAP = 0.01;

describe('planForwardChunkPlayback', () => {
  it('plays a full interior chunk and crossfades out over the overlap tail', () => {
    const plan = planForwardChunkPlayback({
      chunkStartS: 0,
      chunkDurationS: 5 + OVERLAP, // buffer includes the overlap tail
      chunkNominalDurationS: 5,
      currentSourceTimeS: 0,
      remainingToPlayS: 100, // long clip → has successor
      overlapS: OVERLAP,
    });
    expect(plan.offsetInChunkS).toBe(0);
    expect(plan.playDurationS).toBeCloseTo(5, 9); // cursor advances by nominal only
    expect(plan.tailOverlapS).toBeCloseTo(OVERLAP, 9);
    expect(plan.totalPlayS).toBeCloseTo(5 + OVERLAP, 9);
    expect(plan.hasSuccessor).toBe(true);
  });

  it('does not overlap the last chunk (fades to silence at clip end)', () => {
    const plan = planForwardChunkPlayback({
      chunkStartS: 0,
      chunkDurationS: 5 + OVERLAP,
      chunkNominalDurationS: 5,
      currentSourceTimeS: 0,
      remainingToPlayS: 5, // exactly this chunk's nominal → no successor
      overlapS: OVERLAP,
    });
    expect(plan.playDurationS).toBeCloseTo(5, 9);
    expect(plan.tailOverlapS).toBe(0);
    expect(plan.hasSuccessor).toBe(false);
  });

  it('plays only the remaining content when the clip ends mid-chunk', () => {
    const plan = planForwardChunkPlayback({
      chunkStartS: 0,
      chunkDurationS: 5 + OVERLAP,
      chunkNominalDurationS: 5,
      currentSourceTimeS: 0,
      remainingToPlayS: 2,
      overlapS: OVERLAP,
    });
    expect(plan.playDurationS).toBeCloseTo(2, 9);
    expect(plan.tailOverlapS).toBe(0); // ran out before the nominal boundary
    expect(plan.hasSuccessor).toBe(false);
  });

  it('honours a read offset partway into the chunk', () => {
    const plan = planForwardChunkPlayback({
      chunkStartS: 10,
      chunkDurationS: 5 + OVERLAP,
      chunkNominalDurationS: 5,
      currentSourceTimeS: 12,
      remainingToPlayS: 100,
      overlapS: OVERLAP,
    });
    expect(plan.offsetInChunkS).toBeCloseTo(2, 9);
    expect(plan.playDurationS).toBeCloseTo(3, 9); // 12 → nominal end 15
    expect(plan.tailOverlapS).toBeCloseTo(OVERLAP, 9);
  });

  it('caps the tail at the actually-decoded overlap', () => {
    const plan = planForwardChunkPlayback({
      chunkStartS: 0,
      chunkDurationS: 5 + 0.003, // only 3ms decoded past nominal
      chunkNominalDurationS: 5,
      currentSourceTimeS: 0,
      remainingToPlayS: 100,
      overlapS: OVERLAP, // wants 10ms
    });
    expect(plan.tailOverlapS).toBeCloseTo(0.003, 9);
  });

  it('legacy chunk without overlap (no nominal field) yields no tail', () => {
    const plan = planForwardChunkPlayback({
      chunkStartS: 0,
      chunkDurationS: 5, // buffer == nominal, no overlap
      chunkNominalDurationS: undefined,
      currentSourceTimeS: 0,
      remainingToPlayS: 100,
      overlapS: OVERLAP,
    });
    expect(plan.playDurationS).toBeCloseTo(5, 9);
    expect(plan.tailOverlapS).toBe(0);
    expect(plan.hasSuccessor).toBe(true);
  });

  it('the cursor advance never includes the overlap (no double-play)', () => {
    // Two consecutive interior chunks: the second must resume exactly at the
    // first chunk's nominal boundary, not past it.
    const first = planForwardChunkPlayback({
      chunkStartS: 0,
      chunkDurationS: 5 + OVERLAP,
      chunkNominalDurationS: 5,
      currentSourceTimeS: 0,
      remainingToPlayS: 100,
      overlapS: OVERLAP,
    });
    const cursorAfterFirst = 0 + first.playDurationS;
    expect(cursorAfterFirst).toBeCloseTo(5, 9);

    const second = planForwardChunkPlayback({
      chunkStartS: 5,
      chunkDurationS: 5 + OVERLAP,
      chunkNominalDurationS: 5,
      currentSourceTimeS: cursorAfterFirst,
      remainingToPlayS: 100 - first.playDurationS,
      overlapS: OVERLAP,
    });
    expect(second.offsetInChunkS).toBeCloseTo(0, 9); // resumes at the boundary
  });
});
