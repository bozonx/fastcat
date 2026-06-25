/** @vitest-environment node */
import { describe, it, expect } from 'vitest';

import {
  planarToInterleaved,
  interleaveFromPlanes,
  estimateEffectTailS,
  estimateClipProcessingOverlapS,
  crossfadePendingTailIntoBlock,
  PlanarFifo,
  CLIP_PROCESS_BLOCK_DURATION_S,
  type PendingProcessedTail,
} from '~/workers/core/audio-dsp';
import type { AudioEffectData } from '~/utils/audio/apply-audio-effects-offline';

describe('planarToInterleaved', () => {
  it('converts planar stereo to interleaved', () => {
    // Planar: [L0, L1, L2, R0, R1, R2] → interleaved: [L0, R0, L1, R1, L2, R2]
    const planar = new Float32Array([1, 2, 3, 10, 20, 30]);
    const result = planarToInterleaved({ planar, frames: 3, numberOfChannels: 2 });
    expect(Array.from(result)).toEqual([1, 10, 2, 20, 3, 30]);
  });

  it('converts planar mono to interleaved (identity layout)', () => {
    const planar = new Float32Array([1, 2, 3]);
    const result = planarToInterleaved({ planar, frames: 3, numberOfChannels: 1 });
    expect(Array.from(result)).toEqual([1, 2, 3]);
  });

  it('reuses interleavedOut when provided', () => {
    const planar = new Float32Array([1, 2, 10, 20]);
    const out = new Float32Array(4);
    const result = planarToInterleaved({ planar, frames: 2, numberOfChannels: 2, interleavedOut: out });
    expect(result).toBe(out);
    expect(Array.from(result)).toEqual([1, 10, 2, 20]);
  });

  it('handles missing samples with zero fallback', () => {
    // Planar shorter than expected — missing values become 0
    const planar = new Float32Array([1, 2]);
    const result = planarToInterleaved({ planar, frames: 3, numberOfChannels: 2 });
    // L: [1, 2, 0], R: [0, 0, 0] (planar[3..5] missing)
    expect(Array.from(result)).toEqual([1, 0, 2, 0, 0, 0]);
  });
});

describe('interleaveFromPlanes', () => {
  it('interleaves from separate planes with startFrame offset', () => {
    const planes = [new Float32Array([0, 1, 2, 3, 4]), new Float32Array([10, 11, 12, 13, 14])];
    const result = interleaveFromPlanes(planes, 1, 3, 2);
    // startFrame=1, frames=3 → L[1..3]=1,2,3 R[1..3]=11,12,13
    expect(Array.from(result)).toEqual([1, 11, 2, 12, 3, 13]);
  });

  it('handles missing plane channel with zeros', () => {
    const planes = [new Float32Array([1, 2, 3])];
    const result = interleaveFromPlanes(planes, 0, 3, 2);
    // Channel 1 missing → zeros
    expect(Array.from(result)).toEqual([1, 0, 2, 0, 3, 0]);
  });

  it('handles startFrame beyond plane length', () => {
    const planes = [new Float32Array([1, 2]), new Float32Array([3, 4])];
    const result = interleaveFromPlanes(planes, 5, 2, 2);
    expect(Array.from(result)).toEqual([0, 0, 0, 0]);
  });
});

describe('estimateEffectTailS', () => {
  function makeEffect(overrides: Partial<AudioEffectData> = {}): AudioEffectData {
    return { id: 'fx1', type: 'audio-reverb', enabled: true, target: 'audio', ...overrides };
  }

  it('returns 0 for disabled effects', () => {
    expect(estimateEffectTailS(makeEffect({ enabled: false }))).toBe(0);
  });

  it('returns 0 for non-audio target', () => {
    expect(estimateEffectTailS(makeEffect({ target: 'video' }))).toBe(0);
  });

  it('estimates reverb tail as decay + preDelay', () => {
    const tail = estimateEffectTailS(makeEffect({ type: 'audio-reverb', decay: 3, preDelay: 0.1 }));
    expect(tail).toBeCloseTo(3.1, 5);
  });

  it('clamps reverb decay to [0.1, 10]', () => {
    // decay=100 → clamp(100, 0.1, 10)=10, preDelay default fallback=0.01 → 10.01
    const tooLong = estimateEffectTailS(makeEffect({ type: 'audio-reverb', decay: 100, preDelay: 0 }));
    expect(tooLong).toBeCloseTo(10, 5);

    // decay=0 → clamp(0, 0.1, 10)=0.1, preDelay=0 → 0.1
    const tooShort = estimateEffectTailS(makeEffect({ type: 'audio-reverb', decay: 0, preDelay: 0 }));
    expect(tooShort).toBeCloseTo(0.1, 5);
  });

  it('uses fallback for non-finite reverb decay', () => {
    // clampFinite(NaN, 2.5) → 2.5, clamp(2.5, 0.1, 10) → 2.5
    // preDelay undefined → clampFinite(undefined, 0.01) → 0.01 → total 2.51
    const tail = estimateEffectTailS(makeEffect({ type: 'audio-reverb', decay: NaN, preDelay: 0 }));
    expect(tail).toBeCloseTo(2.5, 5);
  });

  it('estimates stadium tail based on size', () => {
    const small = estimateEffectTailS(makeEffect({ type: 'audio-env-stadium', size: 0 }));
    expect(small).toBeCloseTo(1, 5);

    const large = estimateEffectTailS(makeEffect({ type: 'audio-env-stadium', size: 100 }));
    expect(large).toBeCloseTo(5, 5);

    const mid = estimateEffectTailS(makeEffect({ type: 'audio-env-stadium', size: 50 }));
    expect(mid).toBeCloseTo(3, 5);
  });

  it('returns fixed tails for known effect types', () => {
    expect(estimateEffectTailS(makeEffect({ type: 'audio-thought-monologue' }))).toBeCloseTo(2.2);
    expect(estimateEffectTailS(makeEffect({ type: 'audio-env-behind-wall' }))).toBeCloseTo(1);
    expect(estimateEffectTailS(makeEffect({ type: 'audio-flanger' }))).toBeCloseTo(0.08);
    expect(estimateEffectTailS(makeEffect({ type: 'audio-voice-robot' }))).toBeCloseTo(0.08);
    expect(estimateEffectTailS(makeEffect({ type: 'audio-old-vinyl' }))).toBeCloseTo(0.12);
    expect(estimateEffectTailS(makeEffect({ type: 'audio-compressor' }))).toBeCloseTo(0.4);
    expect(estimateEffectTailS(makeEffect({ type: 'audio-phaser' }))).toBeCloseTo(0.2);
  });

  it('estimates echo tail from delayTime and feedback', () => {
    const tail = estimateEffectTailS(
      makeEffect({ type: 'audio-echo', delayTime: 0.5, feedback: 0.5 }),
    );
    // delayTime=0.5, feedback=0.5 → ceil(1/(1-0.5))=2, 0.5*2=1.0
    expect(tail).toBeCloseTo(1.0, 5);
  });

  it('clamps echo tail to 8s maximum', () => {
    const tail = estimateEffectTailS(
      makeEffect({ type: 'audio-echo', delayTime: 1, feedback: 0.9 }),
    );
    // delayTime=1, feedback=0.9 → ceil(1/0.1)=10, 1*10=10 → clamped to 8
    expect(tail).toBeCloseTo(8, 5);
  });

  it('returns 0 for unknown effect types', () => {
    expect(estimateEffectTailS(makeEffect({ type: 'unknown-future-effect' }))).toBe(0);
  });
});

describe('estimateClipProcessingOverlapS', () => {
  function makeEffect(overrides: Partial<AudioEffectData> = {}): AudioEffectData {
    return { id: 'fx1', type: 'audio-reverb', enabled: true, target: 'audio', ...overrides };
  }

  it('returns 0 when no effects are enabled', () => {
    expect(estimateClipProcessingOverlapS([])).toBe(0);
    expect(estimateClipProcessingOverlapS([makeEffect({ enabled: false })])).toBe(0);
    expect(estimateClipProcessingOverlapS([makeEffect({ target: 'video' })])).toBe(0);
  });

  it('returns the max tail across all enabled effects', () => {
    const effects = [
      makeEffect({ id: 'fx1', type: 'audio-flanger' }),
      makeEffect({ id: 'fx2', type: 'audio-reverb', decay: 5, preDelay: 0 }),
    ];
    // flanger=0.08, reverb: decay=5 + preDelay=0 → 5 → max=5
    expect(estimateClipProcessingOverlapS(effects)).toBeCloseTo(5, 5);
  });

  it('clamps the overlap to at least 0.05s', () => {
    const effects = [makeEffect({ type: 'audio-flanger' })];
    // flanger tail=0.08 → max(0.05, 0.08)=0.08
    expect(estimateClipProcessingOverlapS(effects)).toBeCloseTo(0.08, 5);
  });

  it('clamps the overlap to CLIP_PROCESS_BLOCK_DURATION_S', () => {
    const effects = [makeEffect({ type: 'audio-reverb', decay: 100 })];
    // reverb tail clamped to 10 → min(10, 10)=10
    expect(estimateClipProcessingOverlapS(effects)).toBe(CLIP_PROCESS_BLOCK_DURATION_S);
  });
});

describe('crossfadePendingTailIntoBlock', () => {
  it('is a no-op when pendingTail is null', () => {
    const block = [new Float32Array([1, 2, 3])];
    crossfadePendingTailIntoBlock({ pendingTail: null, blockPlanes: block, channels: 1 });
    expect(Array.from(block[0])).toEqual([1, 2, 3]);
  });

  it('is a no-op when overlap is 0', () => {
    const pendingTail: PendingProcessedTail = {
      startFrame: 0,
      planes: [new Float32Array(0)],
    };
    const block = [new Float32Array([1, 2, 3])];
    crossfadePendingTailIntoBlock({ pendingTail, blockPlanes: block, channels: 1 });
    expect(Array.from(block[0])).toEqual([1, 2, 3]);
  });

  it('crossfades tail into block with equal-power gains', () => {
    const pendingTail: PendingProcessedTail = {
      startFrame: 0,
      planes: [new Float32Array([1, 1, 1, 1])],
    };
    const block = [new Float32Array([0, 0, 0, 0])];
    crossfadePendingTailIntoBlock({ pendingTail, blockPlanes: block, channels: 1 });

    // 4 overlap frames, progress = i / (overlapFrames - 1) = i / 3
    // i=0: progress=0 → out=cos(0)=1, in=sin(0)=0 → block=1*1+0*0=1
    expect(block[0][0]).toBeCloseTo(1, 5);
    // i=3: progress=1 → out=cos(π/2)=0, in=sin(π/2)=1 → block=1*0+0*1=0
    expect(block[0][3]).toBeCloseTo(0, 5);
    // i=1: progress=1/3 → out=cos(π/6)≈0.866, in=sin(π/6)≈0.5 → block=0.866
    expect(block[0][1]).toBeCloseTo(Math.cos(Math.PI / 6), 4);
    // i=2: progress=2/3 → out=cos(π/3)≈0.5, in=sin(π/3)≈0.866 → block=0.5
    expect(block[0][2]).toBeCloseTo(Math.cos(Math.PI / 3), 4);
  });

  it('handles single-frame overlap as passthrough', () => {
    const pendingTail: PendingProcessedTail = {
      startFrame: 0,
      planes: [new Float32Array([0.5])],
    };
    const block = [new Float32Array([0.8])];
    crossfadePendingTailIntoBlock({ pendingTail, blockPlanes: block, channels: 1 });
    // overlapFrames=1 → block[i] = block[i] ?? 0 (passthrough, no crossfade)
    expect(block[0][0]).toBeCloseTo(0.8, 5);
  });

  it('processes multiple channels', () => {
    const pendingTail: PendingProcessedTail = {
      startFrame: 0,
      planes: [new Float32Array([1, 1]), new Float32Array([2, 2])],
    };
    const block = [new Float32Array([0, 0]), new Float32Array([0, 0])];
    crossfadePendingTailIntoBlock({ pendingTail, blockPlanes: block, channels: 2 });

    // Channel 0: progress 0 → 1*1+0*0=1, progress 1 → 1*0+0*1=0
    expect(block[0][0]).toBeCloseTo(1, 5);
    expect(block[0][1]).toBeCloseTo(0, 5);
    // Channel 1: same shape
    expect(block[1][0]).toBeCloseTo(2, 5);
    expect(block[1][1]).toBeCloseTo(0, 5);
  });
});

describe('PlanarFifo', () => {
  it('starts empty', () => {
    const fifo = new PlanarFifo(2, 100);
    expect(fifo.length).toBe(0);
  });

  it('appends and reads data', () => {
    const fifo = new PlanarFifo(2, 100);
    fifo.append([new Float32Array([1, 2, 3]), new Float32Array([10, 20, 30])], 3);
    expect(fifo.length).toBe(3);

    const read = fifo.read(2);
    expect(read).toHaveLength(2);
    expect(Array.from(read[0])).toEqual([1, 2]);
    expect(Array.from(read[1])).toEqual([10, 20]);
    expect(fifo.length).toBe(3); // read doesn't consume
  });

  it('drop removes frames from the front', () => {
    const fifo = new PlanarFifo(1, 100);
    fifo.append([new Float32Array([1, 2, 3, 4])], 4);
    fifo.drop(2);
    expect(fifo.length).toBe(2);

    const read = fifo.read(2);
    expect(Array.from(read[0])).toEqual([3, 4]);
  });

  it('drop resets when all frames are consumed', () => {
    const fifo = new PlanarFifo(1, 100);
    fifo.append([new Float32Array([1, 2])], 2);
    fifo.drop(2);
    expect(fifo.length).toBe(0);
    // Internal pointers should be reset
    fifo.append([new Float32Array([3, 4])], 2);
    expect(fifo.length).toBe(2);
    expect(Array.from(fifo.read(2)[0])).toEqual([3, 4]);
  });

  it('ignores append with 0 frames', () => {
    const fifo = new PlanarFifo(1, 100);
    fifo.append([new Float32Array([1])], 0);
    expect(fifo.length).toBe(0);
  });

  it('grows capacity when appending beyond initial size', () => {
    const fifo = new PlanarFifo(1, 4);
    // Fill beyond initial capacity
    fifo.append([new Float32Array([1, 2, 3])], 3);
    fifo.drop(3);
    fifo.append([new Float32Array([4, 5, 6, 7, 8])], 5);
    expect(fifo.length).toBe(5);
    expect(Array.from(fifo.read(5)[0])).toEqual([4, 5, 6, 7, 8]);
  });

  it('handles multiple channels independently', () => {
    const fifo = new PlanarFifo(2, 100);
    fifo.append(
      [new Float32Array([1, 2, 3]), new Float32Array([10, 20, 30])],
      3,
    );
    fifo.drop(1);
    const read = fifo.read(2);
    expect(Array.from(read[0])).toEqual([2, 3]);
    expect(Array.from(read[1])).toEqual([20, 30]);
  });

  it('read returns fewer frames than requested when not enough available', () => {
    const fifo = new PlanarFifo(1, 100);
    fifo.append([new Float32Array([1, 2])], 2);
    const read = fifo.read(10);
    expect(read[0].length).toBe(2);
    expect(Array.from(read[0])).toEqual([1, 2]);
  });

  it('handles negative drop count gracefully', () => {
    const fifo = new PlanarFifo(1, 100);
    fifo.append([new Float32Array([1, 2])], 2);
    fifo.drop(-5);
    expect(fifo.length).toBe(2);
  });
});
