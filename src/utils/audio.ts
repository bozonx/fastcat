export function formatAudioChannels(channels: number | undefined): string {
  if (!channels || channels <= 0) return '-';
  if (channels === 1) return 'Mono';
  if (channels === 2) return 'Stereo';
  return `${channels} tracks`;
}

export function linearToDb(linear: number, minDb = -60): number {
  if (linear <= 0.001) return minDb;
  return 20 * Math.log10(linear);
}

export function dbToLinear(db: number, minDb = -60): number {
  if (db <= minDb) return 0;
  return Math.pow(10, db / 20);
}
