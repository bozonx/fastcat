const FALLBACK_FPS = 30;
const MIN_FPS = 1;
const MAX_FPS = 240;

export function normalizeTimeUs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.round(value);
}

export function clampTimeUs(value: number, maxDurationUs: number): number {
  const normalizedValue = normalizeTimeUs(value);
  const normalizedMax = normalizeTimeUs(maxDurationUs);

  if (normalizedValue <= 0) {
    return 0;
  }

  if (normalizedMax <= 0) {
    return normalizedValue;
  }

  if (normalizedValue >= normalizedMax) {
    return normalizedMax;
  }

  return normalizedValue;
}

/**
 * Sanitize fps preserving non-integer rates required for NTSC (29.97, 23.976,
 * 59.94, …). We clamp to a reasonable range and quantize to 3 decimal places to
 * keep the value finite and free of float noise without forcing integer-only
 * fps. This mirrors `sanitizeFps` in `~/timeline/commands/utils` and
 * `~/utils/timeline/geometry`; rounding to an integer here would make the
 * monitor's timecode and frame interval disagree with the ruler and playhead,
 * which use the real fps.
 */
export function sanitizeFps(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return FALLBACK_FPS;
  }

  const clamped = Math.min(MAX_FPS, Math.max(MIN_FPS, parsed));
  return Math.round(clamped * 1000) / 1000;
}
