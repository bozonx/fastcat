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
 * Formats microseconds to HH:MM:SS:FF timecode string.
 * Rounds the frame part to handle non-integer FPS correctly.
 *
 * @param us - Time in microseconds
 * @param fps - Frames per second
 * @returns Formatted timecode string
 */
export function formatTimecode(us: number, fps: number): string {
  if (!Number.isFinite(fps) || fps <= 0) {
    return '00:00:00:00';
  }

  const isNegative = us < 0;
  const absUs = Math.abs(us);

  // Calculate total frames and round to nearest integer to avoid floating point issues
  const totalFrames = Math.round((absUs / 1_000_000) * fps);

  // We ensure that ff is an integer within the range [0, ceil(fps)-1]
  // Using Math.floor on the result of modulo handles non-integer FPS by rolling over at the right moment
  const ff = Math.floor(totalFrames % fps);

  // Derived from totalFrames to stay consistent with ff
  const totalSeconds = Math.floor(totalFrames / fps);
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);

  const pad = (n: number) => String(Math.floor(n)).padStart(2, '0');
  const formatted = `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`;

  return isNegative ? `-${formatted}` : formatted;
}

/**
 * Formats microseconds to HH:MM:SS string.
 *
 * @param us - Time in microseconds
 * @returns Formatted time string in hours:minutes:seconds
 */
export function formatHms(us: number): string {
  const isNegative = us < 0;
  const absUs = Math.abs(us);
  const totalSeconds = Math.floor(absUs / 1_000_000);
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);

  const pad = (n: number) => String(n).padStart(2, '0');
  const formatted = `${pad(hh)}:${pad(mm)}:${pad(ss)}`;

  return isNegative ? `-${formatted}` : formatted;
}

/**
 * Formats microseconds to MM:SS or HH:MM:SS string if >= 1 hour.
 *
 * @param us - Time in microseconds
 * @returns Formatted time string
 */
export function formatMsOrHms(us: number): string {
  const isNegative = us < 0;
  const absUs = Math.abs(us);
  const totalSeconds = Math.floor(absUs / 1_000_000);
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
