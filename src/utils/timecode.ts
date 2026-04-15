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
