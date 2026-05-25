import type { TimelineClipItem, TimelineDocument } from '~/timeline/types';
import { isClipFrameAligned } from '~/utils/timeline/clip-capabilities';

export function isClipFreePosition(
  clipItem: TimelineClipItem | null,
  timelineDoc: TimelineDocument | null,
  fps: number,
): boolean {
  if (!clipItem || !timelineDoc) return false;
  return !isClipFrameAligned(clipItem, fps);
}
