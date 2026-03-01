/**
 * Formats bytes to a human-readable string (e.g., 1.23 GB).
 */
export function formatBytes(bytes: number, decimals = 2): string {
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

/**
 * Formats bytes specifically to Megabytes (e.g., 10.50 MB).
 */
export function formatMegabytes(bytes: number, decimals = 2): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(decimals)} MB`;
}
