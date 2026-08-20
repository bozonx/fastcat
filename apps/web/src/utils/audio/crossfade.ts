/**
 * Shared equal-power crossfade primitives used by both audio tracts so preview
 * (WebAudioEngine) and export (AudioMixer) stitch seams identically.
 *
 * Equal-power (constant-power) law: the outgoing signal is scaled by cos and
 * the incoming by sin of a quarter-turn, so `out² + in² === 1` at every point.
 * This keeps perceived loudness constant across a seam between two (possibly
 * differing) signals, unlike a linear crossfade whose power dips ~3 dB at the
 * midpoint.
 */

/** Default seam crossfade length, in seconds (10 ms). Long enough to mask a
 *  per-chunk decode-boundary discontinuity, short enough to be inaudible. */
export const SEAM_CROSSFADE_S = 0.01;

/** Equal-power gains at crossfade progress `p` ∈ [0, 1] (clamped).
 *  `out` fades 1→0 (outgoing/previous), `in` fades 0→1 (incoming/next). */
export function equalPowerGains(p: number): { out: number; in: number } {
  const angle = Math.min(1, Math.max(0, p)) * 0.5 * Math.PI;
  return { out: Math.cos(angle), in: Math.sin(angle) };
}

/**
 * Builds a `Float32Array` of equal-power gain values suitable for
 * `AudioParam.setValueCurveAtTime`. `direction: 'in'` ramps 0→1 (sin),
 * `'out'` ramps 1→0 (cos). `points` controls curve resolution.
 */
export function equalPowerCurve(direction: 'in' | 'out', points = 64): Float32Array {
  const n = Math.max(2, Math.round(points));
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const p = i / (n - 1);
    const g = equalPowerGains(p);
    curve[i] = direction === 'in' ? g.in : g.out;
  }
  return curve;
}
