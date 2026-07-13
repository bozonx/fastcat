import { TICKS_PER_SECOND } from './ticks';

export const US_PER_SEC = TICKS_PER_SECOND;

export const FALLBACK_FPS = 30;
export const MIN_FPS = 1;
export const MAX_FPS = 240;

/**
 * Convert seconds to integer microseconds.
 * Centralized helper to avoid `Math.floor`/`Math.round` mismatches across the
 * timeline import pipeline (preview vs. insert duration).
 *
 * Clamps non-positive inputs to 0. Use {@link sToUs} when a signed result is
 * required (e.g. negative timeline offsets).
 */
export function secondsToUs(seconds: number, mode: 'round' | 'floor' | 'ceil' = 'round'): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  const us = seconds * US_PER_SEC;
  if (mode === 'floor') return Math.floor(us);
  if (mode === 'ceil') return Math.ceil(us);
  return Math.round(us);
}

/**
 * Convert microseconds to seconds.
 * Returns 0 for non-finite or negative inputs.
 */
export function usToS(us: number): number {
  if (!Number.isFinite(us) || us <= 0) return 0;
  return us / US_PER_SEC;
}

/**
 * Convert seconds to microseconds, symmetric to {@link usToS} but
 * sign-preserving: unlike {@link secondsToUs}, negative inputs stay negative.
 */
export function sToUs(seconds: number): number {
  if (!Number.isFinite(seconds)) return 0;
  return Math.round(seconds * US_PER_SEC);
}

/**
 * Sanitize fps preserving non-integer rates required for NTSC (29.97, 23.976, 59.94, …).
 * We clamp to a reasonable range and quantize to 3 decimal places to keep the value finite
 * and free of float noise without forcing integer-only fps.
 */
export function sanitizeFps(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return FALLBACK_FPS;
  const clamped = Math.min(MAX_FPS, Math.max(MIN_FPS, parsed));
  return Math.round(clamped * 1000) / 1000;
}

/** Round a microsecond value to an integer, clamping non-finite/negative to 0. */
export function normalizeTimeUs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.round(value);
}

/** Clamp a microsecond value into the inclusive range [0, maxDurationUs]. */
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
