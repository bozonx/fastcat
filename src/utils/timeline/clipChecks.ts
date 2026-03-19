import type { TimelineClipItem, TimelineDocument } from '~/timeline/types';

export function isClipFreePosition(
  clipItem: TimelineClipItem | null,
  timelineDoc: TimelineDocument | null,
  fps: number
): boolean {
  if (!clipItem || !timelineDoc) return false;
  const startFrame = (clipItem.timelineRange.startUs * fps) / 1_000_000;
  const durFrame = (clipItem.timelineRange.durationUs * fps) / 1_000_000;
  return (
    Math.abs(startFrame - Math.round(startFrame)) > 0.001 ||
    Math.abs(durFrame - Math.round(durFrame)) > 0.001
  );
}
