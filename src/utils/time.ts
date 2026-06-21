export const US_PER_SEC = 1_000_000;

export const FALLBACK_FPS = 30;
export const MIN_FPS = 1;
export const MAX_FPS = 240;

/**
 * Convert seconds to integer microseconds.
 * Centralized helper to avoid `Math.floor`/`Math.round` mismatches across the
 * timeline import pipeline (preview vs. insert duration).
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
 * Convert seconds to microseconds, keeping the name symmetric to usToS.
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

/**
 * Formats seconds into a MM:SS string.
 * @param seconds number of seconds
 * @returns string MM:SS
 */
export function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '00:00';
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${m}:${s}`;
}
