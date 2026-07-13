import type { TimelineClipItem, TimelineTrack } from '~/timeline/types';
import { TICKS_PER_SECOND } from '~/utils/time';

export interface TimelineClipRef {
  track: TimelineTrack;
  clip: TimelineClipItem;
}

export function clipSupportsAudioControls(
  track: Pick<TimelineTrack, 'kind'>,
  clip: Pick<TimelineClipItem, 'clipType' | 'isImage'>,
): boolean {
  if (track.kind === 'audio') return true;
  if (track.kind !== 'video') return false;
  if (clip.clipType === 'timeline') return true;
  return clip.clipType === 'media' && !clip.isImage;
}

export function clipSupportsWaveformControls(
  track: Pick<TimelineTrack, 'kind'>,
  clip: Pick<TimelineClipItem, 'clipType' | 'isImage'>,
): boolean {
  return clipSupportsAudioControls(track, clip);
}

export function clipSupportsThumbnailControls(
  track: Pick<TimelineTrack, 'kind'>,
  clip: Pick<TimelineClipItem, 'clipType'>,
): boolean {
  return track.kind === 'video' && (clip.clipType === 'media' || clip.clipType === 'timeline');
}

export function clipSupportsSpeedControls(
  track: Pick<TimelineTrack, 'kind'>,
  clip: Pick<TimelineClipItem, 'clipType' | 'isImage'>,
): boolean {
  if (track.kind === 'audio') return true;
  if (track.kind !== 'video') return false;
  if (clip.clipType === 'timeline') return true;
  return clip.clipType === 'media' && !clip.isImage;
}

export function clipSupportsReverseControls(
  track: Pick<TimelineTrack, 'kind'>,
  clip: Pick<TimelineClipItem, 'clipType' | 'isImage'>,
): boolean {
  return track.kind === 'video' && clipSupportsSpeedControls(track, clip);
}

export function clipSupportsVisualControls(track: Pick<TimelineTrack, 'kind'>): boolean {
  return track.kind === 'video';
}

export function clipSupportsSourceOrientation(
  track: Pick<TimelineTrack, 'kind'>,
  clip: Pick<TimelineClipItem, 'clipType'>,
): boolean {
  return track.kind === 'video' && clip.clipType === 'media';
}

export function clipSupportsAutoMontage(
  track: Pick<TimelineTrack, 'kind'>,
  clip: Pick<TimelineClipItem, 'clipType' | 'isImage'>,
): boolean {
  return track.kind === 'video' && clip.clipType === 'media' && !clip.isImage;
}

export function getSelectedClipRefs(
  doc: { tracks: TimelineTrack[] } | null,
  items: Array<{ trackId: string; itemId: string }>,
): TimelineClipRef[] {
  if (!doc) return [];

  const refs: TimelineClipRef[] = [];
  for (const { trackId, itemId } of items) {
    const track = trackId
      ? doc.tracks.find((candidateTrack) => candidateTrack.id === trackId)
      : doc.tracks.find((candidateTrack) =>
          candidateTrack.items.some((candidateItem) => candidateItem.id === itemId),
        );
    const clip = track?.items.find((candidateItem) => candidateItem.id === itemId);
    if (!track || !clip || clip.kind !== 'clip') continue;
    refs.push({ track, clip });
  }
  return refs;
}

/**
 * Whether both edges of the clip land exactly on frame boundaries for the given fps.
 * Shared by quantization checks and the "has free (non-quantized) clip" predicate.
 */
export function isClipFrameAligned(
  clip: Pick<TimelineClipItem, 'timelineRange'>,
  fps: number,
): boolean {
  const startFrame = (clip.timelineRange.startUs * fps) / TICKS_PER_SECOND;
  const durationFrame = (clip.timelineRange.durationUs * fps) / TICKS_PER_SECOND;
  const isStartAligned = Math.abs(startFrame - Math.round(startFrame)) < 0.001;
  const isDurationAligned = Math.abs(durationFrame - Math.round(durationFrame)) < 0.001;
  return isStartAligned && isDurationAligned;
}
