import type { TimelineDocument } from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';

/**
 * Returns commands that remove/shrink markers overlapping [rangeStartUs, rangeEndUs] and
 * shift markers starting at/after rangeEndUs left by (rangeEndUs - rangeStartUs).
 * Pure — does not apply anything. Useful for inclusion in larger batches so a single
 * history entry and reactive flush cover both clip and marker changes.
 */
export function buildRippleMarkerCommands(
  doc: TimelineDocument,
  rangeStartUs: number,
  rangeEndUs: number,
): TimelineCommand[] {
  if (!(rangeEndUs > rangeStartUs)) return [];
  const deltaUs = rangeEndUs - rangeStartUs;
  const markers = (doc.metadata?.fastcat?.markers ?? []) as Array<{
    id: string;
    timeUs: number;
    durationUs?: number;
  }>;
  if (markers.length === 0) return [];

  const cmds: TimelineCommand[] = [];
  for (const m of markers) {
    const mStart = m.timeUs;
    const mEnd = m.timeUs + Math.max(0, m.durationUs ?? 0);
    if (mEnd <= rangeStartUs) continue;
    if (mStart >= rangeEndUs) {
      cmds.push({ type: 'update_marker', id: m.id, timeUs: Math.max(0, mStart - deltaUs) });
      continue;
    }
    if (mStart >= rangeStartUs && mEnd <= rangeEndUs) {
      cmds.push({ type: 'remove_marker', id: m.id });
      continue;
    }
    if (mStart < rangeStartUs && mEnd > rangeEndUs) {
      cmds.push({
        type: 'update_marker',
        id: m.id,
        timeUs: mStart,
        durationUs: Math.max(0, (m.durationUs ?? 0) - deltaUs),
      });
      continue;
    }
    if (mStart < rangeStartUs) {
      cmds.push({
        type: 'update_marker',
        id: m.id,
        timeUs: mStart,
        durationUs: Math.max(0, rangeStartUs - mStart),
      });
      continue;
    }
    // Head overlap: marker starts inside the range, extends past it.
    const newStart = Math.max(0, rangeStartUs);
    const newEnd = Math.max(newStart, mEnd - deltaUs);
    cmds.push({
      type: 'update_marker',
      id: m.id,
      timeUs: newStart,
      durationUs: Math.max(0, newEnd - newStart),
    });
  }
  return cmds;
}
