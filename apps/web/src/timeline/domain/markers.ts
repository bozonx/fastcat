import type { TimelineDocument } from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';

/**
 * Returns commands that remove/shrink markers overlapping [rangeStartTicks, rangeEndTicks] and
 * shift markers starting at/after rangeEndTicks left by (rangeEndTicks - rangeStartTicks).
 * Pure — does not apply anything. Useful for inclusion in larger batches so a single
 * history entry and reactive flush cover both clip and marker changes.
 */
export function buildRippleMarkerCommands(
  doc: TimelineDocument,
  rangeStartTicks: number,
  rangeEndTicks: number,
): TimelineCommand[] {
  if (!(rangeEndTicks > rangeStartTicks)) return [];
  const deltaTicks = rangeEndTicks - rangeStartTicks;
  const markers = (doc.metadata?.fastcat?.markers ?? []) as Array<{
    id: string;
    timeTicks: number;
    durationTicks?: number;
  }>;
  if (markers.length === 0) return [];

  const cmds: TimelineCommand[] = [];
  for (const m of markers) {
    const mStart = m.timeTicks;
    const mEnd = m.timeTicks + Math.max(0, m.durationTicks ?? 0);
    if (mEnd <= rangeStartTicks) continue;
    if (mStart >= rangeEndTicks) {
      cmds.push({ type: 'update_marker', id: m.id, timeTicks: Math.max(0, mStart - deltaTicks) });
      continue;
    }
    if (mStart >= rangeStartTicks && mEnd <= rangeEndTicks) {
      cmds.push({ type: 'remove_marker', id: m.id });
      continue;
    }
    if (mStart < rangeStartTicks && mEnd > rangeEndTicks) {
      cmds.push({
        type: 'update_marker',
        id: m.id,
        timeTicks: mStart,
        durationTicks: Math.max(0, (m.durationTicks ?? 0) - deltaTicks),
      });
      continue;
    }
    if (mStart < rangeStartTicks) {
      cmds.push({
        type: 'update_marker',
        id: m.id,
        timeTicks: mStart,
        durationTicks: Math.max(0, rangeStartTicks - mStart),
      });
      continue;
    }
    // Head overlap: marker starts inside the range, extends past it.
    const newStart = Math.max(0, rangeStartTicks);
    const newEnd = Math.max(newStart, mEnd - deltaTicks);
    cmds.push({
      type: 'update_marker',
      id: m.id,
      timeTicks: newStart,
      durationTicks: Math.max(0, newEnd - newStart),
    });
  }
  return cmds;
}
