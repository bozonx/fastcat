import { computed, type Ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useTimelineSelectionEntities } from './useTimelineSelectionEntities';
import type { TimelineTrack, TimelineClipItem } from '~/timeline/types';
import { isClipItem } from '~/timeline/types';

export function useMobileTimelineSelection(
  tracks: Ref<TimelineTrack[]>,
  isClipPropertiesDrawerOpen: Ref<boolean>,
  isMultiSelectionDrawerOpen: Ref<boolean>,
  isMultiSelectionMode: Ref<boolean>,
  closeAllDrawers: () => void,
) {
  const timelineStore = useTimelineStore();
  const selectionStore = useSelectionStore();

  const selectedTransitionContext = computed(() => {
    const sel = timelineStore.selectedTransition;
    if (!sel) return null;
    const track = tracks.value.find((tr) => tr.id === sel.trackId);
    if (!track) return null;
    const clip = track.items.find((i) => i.id === sel.itemId);
    if (!clip || clip.kind !== 'clip') return null;
    return { track, clip };
  });

  const { selectedMarkerId, selectedGap } = useTimelineSelectionEntities();

  const selectedClipContext = computed<{ track: TimelineTrack; clip: TimelineClipItem } | null>(
    () => {
      const entity = selectionStore.selectedEntity;
      if (entity?.source !== 'timeline' || entity.kind !== 'clip') return null;
      const track = tracks.value.find((item) => item.id === entity.trackId);
      if (!track) return null;
      const clip = track.items.find((item) => item.id === entity.itemId);
      if (!clip || !isClipItem(clip)) return null;
      return { track, clip };
    },
  );

  const itemToTrackMap = computed(() => {
    const map = new Map<string, { trackId: string; item: TimelineTrack['items'][number] }>();
    for (const track of tracks.value) {
      for (const item of track.items) {
        map.set(item.id, { trackId: track.id, item });
      }
    }
    return map;
  });

  const selectedClips = computed(() => {
    const map = itemToTrackMap.value;
    const items: { trackId: string; itemId: string }[] = [];
    for (const itemId of timelineStore.selectedItemIds) {
      const entry = map.get(itemId);
      if (entry && entry.item.kind === 'clip') {
        items.push({ trackId: entry.trackId, itemId });
      }
    }
    return items.length > 0 ? items : null;
  });

  function syncSelectionStoreFromItemIds() {
    const map = itemToTrackMap.value;
    const items: { trackId: string; itemId: string; kind: 'clip' | 'gap' }[] = [];
    for (const itemId of timelineStore.selectedItemIds) {
      const entry = map.get(itemId);
      if (entry) {
        items.push({ trackId: entry.trackId, itemId, kind: entry.item.kind as 'clip' | 'gap' });
      }
    }

    if (items.length === 0) {
      selectionStore.clearSelection();
      return;
    }

    selectionStore.selectTimelineItems(items);
  }

  function toggleMobileClipSelection(itemId: string) {
    timelineStore.toggleSelection(itemId, { multi: true });
    timelineStore.selectTrack(null);
    timelineStore.selectTransition(null);
    syncSelectionStoreFromItemIds();

    const count = timelineStore.selectedItemIds.length;
    if (count === 0) {
      closeAllDrawers();
      return;
    }

    if (isMultiSelectionMode.value || count > 1) {
      isClipPropertiesDrawerOpen.value = false;
      isMultiSelectionDrawerOpen.value = true;
    } else {
      isClipPropertiesDrawerOpen.value = true;
      isMultiSelectionDrawerOpen.value = false;
    }
  }

  function enterMobileMultiSelection(itemId: string) {
    isMultiSelectionMode.value = true;
    timelineStore.selectTrack(null);
    timelineStore.selectTransition(null);

    const isSelected = timelineStore.selectedItemIds.includes(itemId);

    if (!isSelected) {
      timelineStore.clearSelection();
      toggleMobileClipSelection(itemId);
    } else {
      isClipPropertiesDrawerOpen.value = false;
      isMultiSelectionDrawerOpen.value = true;
    }
  }

  return {
    selectedMarkerId,
    selectedTransitionContext,
    selectedGap,
    selectedClipContext,
    selectedClips,
    toggleMobileClipSelection,
    enterMobileMultiSelection,
  };
}
