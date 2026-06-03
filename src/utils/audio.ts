import type { MediaMetadata } from '~/stores/media.store';
import type { TimelineClipItem, TimelineTrack, TimelineTrackItem } from '~/timeline/types';

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

export function getAudioMeterZone(db: number | undefined): 'safe' | 'warning' | 'danger' {
  if (typeof db !== 'number' || !Number.isFinite(db)) return 'safe';
  if (db > 6) return 'danger';
  if (db > 0) return 'warning';
  return 'safe';
}

export function getAudioMeterColorClass(db: number | undefined): string {
  const zone = getAudioMeterZone(db);

  if (zone === 'danger') return 'bg-red-500';
  if (zone === 'warning') return 'bg-yellow-500';
  return 'bg-green-500';
}

export function getAudioMeterPercent(db: number | undefined, minDb = -60, maxDb = 12): number {
  if (typeof db !== 'number' || !Number.isFinite(db)) return 0;
  return Math.max(0, Math.min(100, ((db - minDb) / (maxDb - minDb)) * 100));
}

export function isAudioClipping(db: number | undefined): boolean {
  return typeof db === 'number' && Number.isFinite(db) && db >= 0;
}

export function clipHasAudio(
  item: TimelineTrackItem,
  track: TimelineTrack,
  mediaMetadata: Record<string, MediaMetadata>,
): boolean {
  if (item.kind !== 'clip') return false;

  const clip = item as TimelineClipItem;

  if (clip.clipType !== 'media' && clip.clipType !== 'timeline') return track.kind === 'audio';
  if (!clip.source?.path) return track.kind === 'audio';

  const meta = mediaMetadata[clip.source.path];
  return Boolean(meta?.audio) || track.kind === 'audio';
}

export function trackHasAudio(
  track: TimelineTrack,
  mediaMetadata: Record<string, MediaMetadata>,
): boolean {
  return track.items.some((item) => clipHasAudio(item, track, mediaMetadata));
}

export function clipGainToYPercent(gain: number): number {
  if (gain <= 0) return 100;
  const db = linearToDb(gain);
  if (db >= 0) {
    // Range [1.0, 1.5+] -> [0 dB, 3.52 dB+]
    // Clamped at 1.5 gain (+3.52 dB) which corresponds to 0% (top of clip)
    const maxDb = 20 * Math.log10(1.5);
    const ratio = Math.min(1, db / maxDb);
    return (1 - ratio) * 50; // Map [0, 1] to [50%, 0%]
  } else {
    // Range [0.0, 1.0) -> [-60 dB, 0 dB)
    const ratio = Math.max(0, (db - (-60)) / 60); // Map [-60, 0] to [0, 1]
    return 100 - ratio * 50; // Map [0, 1] to [100%, 50%]
  }
}

export function clipYPercentToGain(yPercent: number): number {
  const y = Math.max(0, Math.min(100, yPercent)) / 100; // Map to [0, 1]
  if (y <= 0.5) {
    // Upper half (gain 1.0 to 1.5)
    const maxDb = 20 * Math.log10(1.5);
    const db = maxDb * (1 - y / 0.5);
    return dbToLinear(db);
  } else {
    // Lower half (gain 0.0 to 1.0)
    const db = 60 * (1 - 2 * y);
    return dbToLinear(db);
  }
}

