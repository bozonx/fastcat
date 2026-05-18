import type { TimelineDocument, TimelineTrackItem } from '../../types';
import type { RemoveItemCommand, DeleteItemsCommand, TimelineCommandResult } from '../../commands';
import { getTrackById, normalizeGaps } from '../utils';

export function removeItems(
  doc: TimelineDocument,
  cmd: RemoveItemCommand | DeleteItemsCommand,
): TimelineCommandResult {
  const track = getTrackById(doc, cmd.trackId);
  const idsToRemove = cmd.type === 'delete_items' ? cmd.itemIds : [cmd.itemId];

  let nextItems = [...track.items];
  let itemsRemoved = false;
  // Linked-audio ids that must be removed together with their video partner.
  const linkedAudioToRemove = new Set<string>();
  // Audio clips whose video partner was removed — their linkedVideoClipId becomes stale.
  const orphanedAudioFromVideoRemoval = new Set<string>();
  // Video clips whose locked-audio partner was removed — clear lockToLinkedVideo to prevent stale state.
  const videoLosingLockedAudio = new Set<string>();

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
      // If this is a video clip being removed, schedule its locked linked audio for removal,
      // and mark any non-locked linked audio as orphan to clear the dangling reference.
      if (track.kind === 'video') {
        for (const t of doc.tracks) {
          if (t.kind !== 'audio') continue;
          for (const audio of t.items) {
            if (audio.kind !== 'clip') continue;
            if (audio.linkedVideoClipId !== item.id) continue;
            if (audio.lockToLinkedVideo && !audio.locked) {
              linkedAudioToRemove.add(audio.id);
            } else {
              orphanedAudioFromVideoRemoval.add(audio.id);
            }
          }
        }
      } else if (track.kind === 'audio' && item.linkedVideoClipId && item.lockToLinkedVideo) {
        // Removing locked audio: clear lock flag on the video side so it doesn't keep a stale reference.
        videoLosingLockedAudio.add(item.linkedVideoClipId);
      }
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

  let nextTracks = doc.tracks.map((t) => (t.id === track.id ? { ...t, items: nextItems } : t));

  if (
    linkedAudioToRemove.size > 0 ||
    orphanedAudioFromVideoRemoval.size > 0 ||
    videoLosingLockedAudio.size > 0
  ) {
    nextTracks = nextTracks.map((t) => {
      if (t.id === track.id) return t;
      let changed = false;
      const items: TimelineTrackItem[] = [];
      for (const it of t.items) {
        if (it.kind !== 'clip') {
          items.push(it);
          continue;
        }
        if (linkedAudioToRemove.has(it.id)) {
          changed = true;
          continue;
        }
        if (orphanedAudioFromVideoRemoval.has(it.id)) {
          changed = true;
          const { linkedVideoClipId: _v, lockToLinkedVideo: _l, ...rest } = it as any;
          items.push(rest as TimelineTrackItem);
          continue;
        }
        if (videoLosingLockedAudio.has(it.id)) {
          changed = true;
          const { lockToLinkedVideo: _l, ...rest } = it as any;
          items.push(rest as TimelineTrackItem);
          continue;
        }
        items.push(it);
      }
      if (!changed) return t;
      items.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);
      return { ...t, items: normalizeGaps(doc, t.id, items, { quantizeToFrames: false }) };
    });
  }

  return { next: { ...doc, tracks: nextTracks } };
}
