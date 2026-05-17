/**
 * Convert seconds to integer microseconds.
 * Centralized helper to avoid `Math.floor`/`Math.round` mismatches across the
 * timeline import pipeline (preview vs. insert duration).
 */
export function secondsToUs(seconds: number, mode: 'round' | 'floor' | 'ceil' = 'round'): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  const us = seconds * 1_000_000;
  if (mode === 'floor') return Math.floor(us);
  if (mode === 'ceil') return Math.ceil(us);
  return Math.round(us);
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
