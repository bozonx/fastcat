import {
  DEFAULT_FRAME_RATE,
  frameRateToNumber,
  sanitizeFrameRate,
  TICKS_PER_SECOND,
} from './ticks';

export const FALLBACK_FPS = 30;
export const MIN_FPS = 1;
export const MAX_FPS = 240;

/**
 * Convert seconds to integer timeline ticks.
 * Centralized helper to avoid `Math.floor`/`Math.round` mismatches across the
 * timeline import pipeline (preview vs. insert duration).
 *
 * Clamps non-positive inputs to 0. Use {@link secondsToTicksSigned} when a
 * signed result is required (e.g. negative timeline offsets).
 */
export function secondsToTicksClamped(
  seconds: number,
  mode: 'round' | 'floor' | 'ceil' = 'round',
): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  const ticks = seconds * TICKS_PER_SECOND;
  if (mode === 'floor') return Math.floor(ticks);
  if (mode === 'ceil') return Math.ceil(ticks);
  return Math.round(ticks);
}

/**
 * Convert timeline ticks to seconds.
 * Returns 0 for non-finite or negative inputs.
 */
export function ticksToSecondsClamped(ticks: number): number {
  if (!Number.isFinite(ticks) || ticks <= 0) return 0;
  return ticks / TICKS_PER_SECOND;
}

/**
 * Convert seconds to timeline ticks, symmetric to {@link ticksToSecondsClamped}
 * but sign-preserving: unlike {@link secondsToTicksClamped}, negative inputs
 * stay negative.
 */
export function secondsToTicksSigned(seconds: number): number {
  if (!Number.isFinite(seconds)) return 0;
  return Math.round(seconds * TICKS_PER_SECOND);
}

/**
 * Sanitize fps preserving non-integer rates required for NTSC (29.97, 23.976, 59.94, …).
 * We clamp to a reasonable range and quantize to 3 decimal places to keep the value finite
 * and free of float noise without forcing integer-only fps.
 */
export function sanitizeFps(value: unknown): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return FALLBACK_FPS;
    return frameRateToNumber(
      sanitizeFrameRate(Math.min(MAX_FPS, Math.max(MIN_FPS, value)), DEFAULT_FRAME_RATE),
    );
  }

  if (typeof value === 'object' && value !== null && 'fps' in value) {
    const fps = Number((value as { fps?: unknown }).fps);
    if (Number.isFinite(fps)) {
      return sanitizeFps(fps);
    }
  }

  return frameRateToNumber(sanitizeFrameRate(value, DEFAULT_FRAME_RATE));
}

/** Round a timeline tick value to an integer, clamping non-finite/negative to 0. */
export function normalizeTicks(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.round(value);
}

/** Clamp a timeline tick value into the inclusive range [0, maxDurationTicks]. */
export function clampTicks(value: number, maxDurationTicks: number): number {
  const normalizedValue = normalizeTicks(value);
  const normalizedMax = normalizeTicks(maxDurationTicks);

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
