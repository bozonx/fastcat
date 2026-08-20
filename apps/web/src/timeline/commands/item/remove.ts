import type { TimelineDocument } from '../../types';
import type { RemoveItemCommand, DeleteItemsCommand, TimelineCommandResult } from '../../commands';
import { normalizeGaps, getLinkedClipGroupItemIds } from '../utils';

export function removeItems(
  doc: TimelineDocument,
  cmd: RemoveItemCommand | DeleteItemsCommand,
): TimelineCommandResult {
  const initialIdsToRemove = cmd.type === 'delete_items' ? cmd.itemIds : [cmd.itemId];

  // Collect all item IDs to remove, expanding linked groups
  const allIdsToRemove = new Set<string>();
  for (const id of initialIdsToRemove) {
    allIdsToRemove.add(id);
    const groupIds = getLinkedClipGroupItemIds(doc, id);
    for (const gid of groupIds) {
      allIdsToRemove.add(gid);
    }
  }

  // Group item IDs by track
  const trackIdToItemIds = new Map<string, string[]>();
  for (const track of doc.tracks) {
    for (const item of track.items) {
      if (allIdsToRemove.has(item.id)) {
        let list = trackIdToItemIds.get(track.id);
        if (!list) {
          list = [];
          trackIdToItemIds.set(track.id, list);
        }
        list.push(item.id);
      }
    }
  }

  if (trackIdToItemIds.size === 0) return { next: doc };

  let changed = false;
  const nextTracks = doc.tracks.map((track) => {
    const idsForTrack = trackIdToItemIds.get(track.id);
    if (!idsForTrack || idsForTrack.length === 0) return track;

    let nextItems = [...track.items];
    let trackItemsRemoved = false;

    for (const itemId of idsForTrack) {
      const idx = nextItems.findIndex((x) => x.id === itemId);
      if (idx === -1) continue;

      const item = nextItems[idx];
      if (!item) continue;

      if (item.kind === 'clip' && item.locked && !cmd.ignoreLocks) {
        continue;
      }
      trackItemsRemoved = true;

      if (item.kind === 'clip') {
        nextItems.splice(idx, 1);
      } else if (item.kind === 'gap') {
        const gapDuration = item.timelineRange.durationTicks;
        const gapEndTicks = item.timelineRange.startTicks + gapDuration;
        nextItems.splice(idx, 1);
        nextItems = nextItems.map((it) => {
          if (it.timelineRange.startTicks >= gapEndTicks) {
            return {
              ...it,
              timelineRange: {
                ...it.timelineRange,
                startTicks: it.timelineRange.startTicks - gapDuration,
              },
            };
          }
          return it;
        });
      }
    }

    if (!trackItemsRemoved) return track;
    changed = true;

    nextItems.sort((a, b) => a.timelineRange.startTicks - b.timelineRange.startTicks);
    nextItems = normalizeGaps(doc, track.id, nextItems, { quantizeToFrames: false });

    return { ...track, items: nextItems };
  });

  if (!changed) return { next: doc };

  return { next: { ...doc, tracks: nextTracks } };
}
