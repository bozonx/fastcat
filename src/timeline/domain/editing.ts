import type { TimelineDocument } from '../types';
import type { TimelineCommand } from '../commands';
import { quantizeTicksToFrames, getDocFps } from '../commands/utils';

export function computeCutTicks(doc: TimelineDocument, atTicks: number): number {
  return quantizeTicksToFrames(Number(atTicks), getDocFps(doc), 'round');
}

export function buildSplitClipCommands(
  doc: TimelineDocument,
  atTicks: number,
  target: { trackId: string; itemId: string } | null,
): TimelineCommand[] {
  if (!target) return [];
  const cutTicks = computeCutTicks(doc, atTicks);
  return [
    { type: 'split_item', trackId: target.trackId, itemId: target.itemId, atTicks: cutTicks },
  ];
}

export function buildSplitAllClipsCommands(
  doc: TimelineDocument,
  atTicks: number,
): TimelineCommand[] {
  const cutTicks = computeCutTicks(doc, atTicks);
  const cmds: TimelineCommand[] = [];
  for (const track of doc.tracks) {
    if (track.locked) continue;
    for (const it of track.items) {
      if (it.kind !== 'clip') continue;
      if (it.locked) continue;
      const startTicks = it.timelineRange.startTicks;
      const endTicks = startTicks + it.timelineRange.durationTicks;
      if (!(cutTicks > startTicks && cutTicks < endTicks)) continue;
      cmds.push({ type: 'split_item', trackId: track.id, itemId: it.id, atTicks: cutTicks });
    }
  }
  return cmds;
}

export function buildSplitSelectedClipsCommands(
  doc: TimelineDocument,
  atTicks: number,
  selectedItemIds: string[],
): TimelineCommand[] {
  const cutTicks = computeCutTicks(doc, atTicks);
  const cmds: TimelineCommand[] = [];
  const selected = new Set(selectedItemIds);
  const shouldUseSelection = selected.size > 0;

  for (const track of doc.tracks) {
    if (track.locked) continue;
    for (const it of track.items) {
      if (it.kind !== 'clip') continue;
      if (it.locked) continue;
      if (shouldUseSelection && !selected.has(it.id)) continue;
      const startTicks = it.timelineRange.startTicks;
      const endTicks = startTicks + it.timelineRange.durationTicks;
      if (!(cutTicks > startTicks && cutTicks < endTicks)) continue;
      cmds.push({ type: 'split_item', trackId: track.id, itemId: it.id, atTicks: cutTicks });
    }
  }
  return cmds;
}
