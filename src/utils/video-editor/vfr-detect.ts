/** Minimum sampled packets needed to judge frame-interval uniformity. Fewer than
 * this (short clip / thin GOP structure) can't reliably distinguish real VFR
 * jitter from noise, so callers should trust an average-rate signal instead. */
export const FRAME_INTERVAL_CHECK_MIN_SAMPLES = 20;

/** How many leading packets (decode order) callers should sample — enough for a
 * solid read without walking the whole track. */
export const FRAME_INTERVAL_CHECK_SAMPLE_PACKETS = 60;

/** Deviation from the nominal frame interval (1/fps) tolerated before a packet
 * gap is treated as VFR jitter rather than container/timebase rounding. */
const TOLERANCE_FRACTION = 0.15;
const TOLERANCE_FLOOR_S = 0.002;

/**
 * Judges whether a sample of PRESENTATION timestamps (seconds) is evenly spaced
 * at `nominalFps` — the shared VFR-detection primitive used by both the export
 * passthrough gate (`export-video-passthrough.ts`) and the media metadata probe
 * (`export.ts` `extractMetadata`). An average frame rate alone can't tell a
 * genuine CFR source from a VFR one whose jittery intervals happen to average to
 * the same number; this checks the intervals themselves.
 *
 * Returns `true` (uniform / CFR-like), `false` (non-uniform / VFR), or `null`
 * when there aren't enough samples to judge reliably — callers decide how to
 * treat "unknown" (e.g. trust another signal, or surface it as "undetermined").
 *
 * `timestampsS` need not be pre-sorted: packet iterators commonly yield decode
 * order, which B-frame reordering can jumble relative to presentation order.
 */
export function checkFrameIntervalUniformity(
  timestampsS: readonly number[],
  nominalFps: number,
): boolean | null {
  if (timestampsS.length < FRAME_INTERVAL_CHECK_MIN_SAMPLES) return null;
  if (!(Number.isFinite(nominalFps) && nominalFps > 0)) return null;

  const sorted = [...timestampsS].sort((a, b) => a - b);
  const nominalIntervalS = 1 / nominalFps;
  const toleranceS = Math.max(TOLERANCE_FLOOR_S, nominalIntervalS * TOLERANCE_FRACTION);

  for (let i = 1; i < sorted.length; i++) {
    const delta = sorted[i]! - sorted[i - 1]!;
    if (Math.abs(delta - nominalIntervalS) > toleranceS) {
      return false;
    }
  }
  return true;
}
