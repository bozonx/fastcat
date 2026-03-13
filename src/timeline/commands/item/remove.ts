import type { TimelineDocument, TimelineTrackItem, TimelineClipItem } from '../../types';
import type {
  AddClipToTrackCommand,
  AddVirtualClipToTrackCommand,
  RemoveItemCommand,
  DeleteItemsCommand,
  MoveItemCommand,
  MoveItemsCommand,
  TrimItemCommand,
  SplitItemCommand,
  MoveItemToTrackCommand,
  OverlayPlaceItemCommand,
  OverlayTrimItemCommand,
  RenameItemCommand,
  UpdateClipPropertiesCommand,
  UpdateClipTransitionCommand,
  TimelineCommandResult,
} from '../../commands';
import {
  getTrackById,
  getDocFps,
  quantizeTimeUsToFrames,
  usToFrame,
  frameToUs,
  computeTrackEndUs,
  assertNoOverlap,
  nextItemId,
  sliceTrackItemsForOverlay,
  normalizeGaps,
  findClipById,
  updateLinkedLockedAudio,
  getLinkedClipGroupItemIds,
  quantizeDeltaUsToFrames,
  clampInt,
  quantizeRangeToFrames,
} from '../utils';
import { normalizeBalance, normalizeGain } from '~/utils/audio/envelope';
import {
  normalizeTransitionCurve,
  normalizeTransitionMode,
  normalizeTransitionParams,
} from '~/transitions';
import type { TransitionCurve, TransitionMode } from '~/transitions';
import { sanitizeTimelineColor } from '~/utils/video-editor/utils';

function assertClipNotLocked(item: TimelineTrackItem, action: string) {
  if (item.kind !== 'clip') return;
  if (!item.locked) return;
  throw new Error(`Locked clip: ${action}`);
}

export function removeItems(
  doc: TimelineDocument,
  cmd: RemoveItemCommand | DeleteItemsCommand,
): TimelineCommandResult {
  const track = getTrackById(doc, cmd.trackId);
  const idsToRemove = cmd.type === 'delete_items' ? cmd.itemIds : [cmd.itemId];

  let nextItems = [...track.items];
  let itemsRemoved = false;

  for (const itemId of idsToRemove) {
    const idx = nextItems.findIndex((x) => x.id === itemId);
    if (idx === -1) continue;

    const item = nextItems[idx];
    if (!item) continue;

    if (item.kind === 'clip' && item.locked && !cmd.ignoreLocks) {
      continue;
    }
    itemsRemoved = true;

    if (item.kind === 'clip') {
      nextItems.splice(idx, 1);
    } else if (item.kind === 'gap') {
      const gapDuration = item.timelineRange.durationUs;
      const gapEndUs = item.timelineRange.startUs + gapDuration;
      nextItems.splice(idx, 1);
      nextItems = nextItems.map((it) => {
        if (it.timelineRange.startUs >= gapEndUs) {
          return {
            ...it,
            timelineRange: {
              ...it.timelineRange,
              startUs: it.timelineRange.startUs - gapDuration,
            },
          };
        }
        return it;
      });
    }
  }

  if (!itemsRemoved) return { next: doc };

  nextItems.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);
  nextItems = normalizeGaps(doc, track.id, nextItems, { quantizeToFrames: false });

  const nextTracks = doc.tracks.map((t) => (t.id === track.id ? { ...t, items: nextItems } : t));
  return { next: { ...doc, tracks: nextTracks } };
}
