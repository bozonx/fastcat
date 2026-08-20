import { computed } from 'vue';
import type { TimelineTrack, TimelineTrackItem } from '~/timeline/types';

export interface MovePreviewEntry {
  itemId: string;
  trackId: string;
  startTicks: number;
  isCollision?: boolean;
}

export interface MovePreviewDeps {
  tracks: () => TimelineTrack[];
  movePreview: () => MovePreviewEntry[] | undefined;
  draggingMode: () => 'move' | 'slip' | 'trim_start' | 'trim_end' | null | undefined;
}

/**
 * Derives the move-preview ghost data for the track loop. Slip drags suppress
 * the ghosts (the original clip stays put and shows a slip overlay instead).
 * Extracted from `TimelineTracks.vue`.
 */
export function useTimelineMovePreviews(deps: MovePreviewDeps) {
  const activeMovePreviews = computed(() =>
    deps.draggingMode() === 'slip' ? [] : (deps.movePreview() ?? []),
  );

  const movePreviewItemsByTrack = computed(() => {
    const previews = activeMovePreviews.value;
    const itemMap = new Map<string, TimelineTrackItem>();

    for (const track of deps.tracks()) {
      for (const item of track.items) {
        itemMap.set(item.id, item);
      }
    }

    const result: Record<
      string,
      Array<{ preview: (typeof previews)[number]; item: TimelineTrackItem }>
    > = {};

    for (const preview of previews) {
      const item = itemMap.get(preview.itemId);
      if (!item) continue;
      if (!result[preview.trackId]) {
        result[preview.trackId] = [];
      }
      result[preview.trackId]!.push({ preview, item });
    }

    return result;
  });

  const movePreviewIds = computed(
    () => new Set(activeMovePreviews.value.map((preview) => preview.itemId)),
  );

  const movePreviewMemoByTrack = computed(() => {
    const result: Record<string, string> = {};
    for (const preview of activeMovePreviews.value) {
      if (!result[preview.trackId]) {
        result[preview.trackId] = '';
      }
      result[preview.trackId] +=
        `${preview.itemId}:${preview.startTicks}:${preview.isCollision ? 1 : 0}|`;
    }
    return result;
  });

  return {
    movePreviewItemsByTrack,
    movePreviewIds,
    movePreviewMemoByTrack,
  };
}
