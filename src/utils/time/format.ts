import { formatTicksAsTimecode, ticksToSeconds } from './ticks';

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

/**
 * Formats timeline ticks to HH:MM:SS:FF timecode string.
 * Rounds the frame part to handle non-integer FPS correctly.
 *
 * @param ticks - Time in timeline ticks
 * @param fps - Frames per second
 * @returns Formatted timecode string
 */
export function formatTimecode(ticks: number, fps: number): string {
  return formatTicksAsTimecode({ ticks, fps });
}

/**
 * Formats timeline ticks to HH:MM:SS string.
 *
 * @param ticks - Time in timeline ticks
 * @returns Formatted time string in hours:minutes:seconds
 */
export function formatHms(ticks: number): string {
  const isNegative = ticks < 0;
  const absTicks = Math.abs(ticks);
  const totalSeconds = Math.floor(ticksToSeconds(absTicks));
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);

  const pad = (n: number) => String(n).padStart(2, '0');
  const formatted = `${pad(hh)}:${pad(mm)}:${pad(ss)}`;

  return isNegative ? `-${formatted}` : formatted;
}

/**
 * Formats timeline ticks to MM:SS or HH:MM:SS string if >= 1 hour.
 *
 * @param ticks - Time in timeline ticks
 * @returns Formatted time string
 */
export function formatMsOrHms(ticks: number): string {
  const isNegative = ticks < 0;
  const absTicks = Math.abs(ticks);
  const totalSeconds = Math.floor(ticksToSeconds(absTicks));
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);

  const pad = (n: number) => String(n).padStart(2, '0');
  let formatted = '';
  if (hh > 0) {
    formatted = `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
  } else {
    formatted = `${pad(mm)}:${pad(ss)}`;
  }

  return isNegative ? `-${formatted}` : formatted;
}

/**
 * Formats a duration given in seconds to a compact M:SS or H:MM:SS string.
 */
export function formatDurationSeconds(totalSeconds: number | undefined | null): string {
  const s = typeof totalSeconds === 'number' && Number.isFinite(totalSeconds) ? totalSeconds : 0;
  if (s <= 0) return '0:00';

  const whole = Math.floor(s);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
