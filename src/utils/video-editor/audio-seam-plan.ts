/**
 * Pure playback geometry for one forward audio chunk, factored out of the
 * WebAudio scheduler so the seam-crossfade math can be unit-tested without an
 * AudioContext.
 *
 * Chunks are decoded with a small trailing overlap (the buffer extends one
 * seam-crossfade past the chunk's nominal end — see AudioChunkDecoder). The
 * scheduler advances the source cursor only by the *nominal* content so chunks
 * never double-play, while the overlapping tail is played at a fading gain that
 * the next chunk crossfades in over (its native content covers the same source
 * region), removing the dip-to-silence that abutting per-chunk fades produced.
 */
const EPS = 1e-9;

export interface ForwardSeamPlanInput {
  /** Source-file time of the first sample in the chunk buffer. */
  chunkStartS: number;
  /** Full playable length of the chunk buffer (may include the overlap tail). */
  chunkDurationS: number;
  /** Cursor-advancing extent (configured chunk size). Falls back to the buffer
   *  length for legacy chunks decoded without overlap, yielding no tail. */
  chunkNominalDurationS?: number;
  /** Current playback position in source-file time. */
  currentSourceTimeS: number;
  /** Remaining clip content to play, in source seconds. */
  remainingToPlayS: number;
  /** Desired seam-crossfade length, in source seconds. */
  overlapS: number;
}

export interface ForwardSeamPlan {
  /** Read offset into the chunk buffer. */
  offsetInChunkS: number;
  /** Nominal content consumed; the cursor/remaining advance by exactly this. */
  playDurationS: number;
  /** Extra buffer content played past the nominal end for the crossfade-out.
   *  0 when this is the last chunk or no overlap is available. */
  tailOverlapS: number;
  /** Total buffer content played by the source node (nominal + tail). */
  totalPlayS: number;
  /** Whether more clip content follows this chunk. */
  hasSuccessor: boolean;
}

/**
 * Computes how much of a forward chunk to play and whether it should crossfade
 * out into its successor. Mirrors the original `min(remaining, available)`
 * cursor behaviour for the nominal portion, then layers the overlap tail on top.
 */
export function planForwardChunkPlayback(input: ForwardSeamPlanInput): ForwardSeamPlan {
  const {
    chunkStartS,
    chunkDurationS,
    chunkNominalDurationS,
    currentSourceTimeS,
    remainingToPlayS,
    overlapS,
  } = input;

  const nominalDurationS = Math.min(
    chunkDurationS,
    chunkNominalDurationS ?? chunkDurationS,
  );

  const offsetInChunkS = Math.max(0, currentSourceTimeS - chunkStartS);
  const nominalEndS = chunkStartS + nominalDurationS;
  const nominalAvailableS = Math.max(0, nominalEndS - currentSourceTimeS);
  const playDurationS = Math.min(Math.max(0, remainingToPlayS), nominalAvailableS);

  const reachedNominalEnd =
    nominalAvailableS > EPS && playDurationS >= nominalAvailableS - EPS;
  const hasSuccessor = remainingToPlayS - playDurationS > EPS;

  const bufferPastNominalS = Math.max(0, chunkStartS + chunkDurationS - nominalEndS);
  const tailOverlapS =
    reachedNominalEnd && hasSuccessor
      ? Math.max(0, Math.min(overlapS, bufferPastNominalS))
      : 0;

  return {
    offsetInChunkS,
    playDurationS,
    tailOverlapS,
    totalPlayS: playDurationS + tailOverlapS,
    hasSuccessor,
  };
}
