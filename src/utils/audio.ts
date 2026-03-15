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

  if (track.kind === 'video' && clip.audioFromVideoDisabled) return false;
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
