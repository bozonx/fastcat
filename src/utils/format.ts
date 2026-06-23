/**
 * Formats bytes to a human-readable string (e.g., 1.23 GB).
 */
export function formatBytes(bytes: number, decimals: number = 0): string {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function formatBitrate(bitsPerSecond: number | undefined | null): string {
  const bps =
    typeof bitsPerSecond === 'number' && Number.isFinite(bitsPerSecond) ? bitsPerSecond : 0;
  if (bps <= 0) return '-';
  if (bps < 1_000) return `${Math.round(bps)} bps`;
  if (bps < 1_000_000) return `${(bps / 1_000).toFixed(0)} kbps`;
  return `${(bps / 1_000_000).toFixed(2)} Mbps`;
}

/**
 * Formats bytes specifically to Megabytes (e.g., 10.50 MB).
 */
export function formatMegabytes(bytes: number, decimals = 2): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(decimals)} MB`;
}

/**
 * Formats FPS to a user-friendly string rounded to 2 decimal places.
 * The original value is preserved internally; this is for display only.
 */
export function formatFps(fps: number | undefined | null): string {
  const value = typeof fps === 'number' && Number.isFinite(fps) ? fps : 0;
  return parseFloat(value.toFixed(3)).toString();
}

/**
 * Formats a render duration in milliseconds to a human-readable string.
 * Shows seconds when under a minute, otherwise MM:SS or H:MM:SS.
 */
export function formatRenderDuration(totalMs: number): string {
  const totalSeconds = Math.round(totalMs / 1000);
  if (totalSeconds < 60) {
    return `${Math.max(1, totalSeconds)}s`;
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Truncates a string from the middle, replacing the omitted part with an ellipsis.
 */
export function middleEllipsis(text: string, maxLen: number = 50): string {
  if (text.length <= maxLen) return text;
  const side = Math.floor((maxLen - 1) / 2);
  return text.slice(0, side) + '…' + text.slice(-side);
}
