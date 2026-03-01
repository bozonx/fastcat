import type { TimelineDocument, TimelineClipItem, TimelineTrack } from '../types';
import type { TimelineCommand } from '../commands';
import { quantizeTimeUsToFrames, getDocFps, usToFrame, frameToUs } from '../commands/utils';

export function computeCutUs(doc: TimelineDocument, atUs: number): number {
  const fps = getDocFps(doc);
  const q = quantizeTimeUsToFrames(Number(atUs), fps, 'round');
  const frame = usToFrame(q, fps, 'round');
  return frameToUs(frame, fps);
}

export function buildSplitClipCommands(
  doc: TimelineDocument,
  atUs: number,
  target: { trackId: string; itemId: string } | null
): TimelineCommand[] {
  if (!target) return [];
  const cutUs = computeCutUs(doc, atUs);
  return [{ type: 'split_item', trackId: target.trackId, itemId: target.itemId, atUs: cutUs }];
}

export function buildSplitAllClipsCommands(doc: TimelineDocument, atUs: number): TimelineCommand[] {
  const cutUs = computeCutUs(doc, atUs);
  const cmds: TimelineCommand[] = [];
  for (const track of doc.tracks) {
    for (const it of track.items) {
      if (it.kind !== 'clip') continue;
      cmds.push({ type: 'split_item', trackId: track.id, itemId: it.id, atUs: cutUs });
    }
  }
  return cmds;
}

export function buildSplitSelectedClipsCommands(
  doc: TimelineDocument,
  atUs: number,
  selectedItemIds: string[]
): TimelineCommand[] {
  const cutUs = computeCutUs(doc, atUs);
  const cmds: TimelineCommand[] = [];
  const selected = new Set(selectedItemIds);
  const shouldUseSelection = selected.size > 0;
  
  for (const track of doc.tracks) {
    for (const it of track.items) {
      if (it.kind !== 'clip') continue;
      if (shouldUseSelection && !selected.has(it.id)) continue;
      cmds.push({ type: 'split_item', trackId: track.id, itemId: it.id, atUs: cutUs });
    }
  }
  return cmds;
}
