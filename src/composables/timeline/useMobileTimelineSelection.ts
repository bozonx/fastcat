import { computed, type Ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import type { TimelineTrack } from '~/timeline/types';

export function useMobileTimelineSelection(
  tracks: Ref<TimelineTrack[]>,
  isClipPropertiesDrawerOpen: Ref<boolean>,
  isMultiSelectionDrawerOpen: Ref<boolean>,
  isLongPress: Ref<boolean>,
  closeAllDrawers: () => void,
) {
  const timelineStore = useTimelineStore();
  const selectionStore = useSelectionStore();

  const selectedMarkerId = computed(() => {
    if (
      selectionStore.selectedEntity?.source === 'timeline' &&
      selectionStore.selectedEntity.kind === 'marker'
    ) {
      const markerId = selectionStore.selectedEntity.markerId;
      if (timelineStore.markers.some((m) => m.id === markerId)) {
        return markerId;
      }
    }
    return null;
  });

  const selectedTransitionContext = computed(() => {
    const sel = timelineStore.selectedTransition;
    if (!sel) return null;
    const track = tracks.value.find((tr) => tr.id === sel.trackId);
    if (!track) return null;
    const clip = track.items.find((i) => i.id === sel.itemId);
    if (!clip || clip.kind !== 'clip') return null;
    return { track, clip };
  });

  const selectedGap = computed(() => {
    const entity = selectionStore.selectedEntity;
    if (entity?.source !== 'timeline' || entity.kind !== 'gap') return null;
    return { trackId: entity.trackId, itemId: entity.itemId };
  });

  const selectedClipContext = computed(() => {
    const entity = selectionStore.selectedEntity;
    if (entity?.source !== 'timeline' || entity.kind !== 'clip') return null;
    const track = tracks.value.find((item) => item.id === entity.trackId);
    if (!track) return null;
    const clip = track.items.find((item) => item.id === entity.itemId);
    if (!clip || clip.kind !== 'clip') return null;
    return { track, clip };
  });

  const selectedClips = computed(() => {
    const items = timelineStore.selectedItemIds.flatMap((itemId) => {
      const track = tracks.value.find((t) => t.items.some((it) => it.id === itemId));
      const item = track?.items.find((it) => it.id === itemId);
      if (!item || item.kind !== 'clip') return [];
      return [{ trackId: track?.id ?? '', itemId }];
    });
    return items.length > 0 ? items : null;
  });

  const isMultiSelectionMode = computed(() => Boolean(selectedClips.value?.length));

  function syncSelectionStoreFromItemIds() {
    const selectedIdSet = new Set(timelineStore.selectedItemIds);
    const items = tracks.value.flatMap((track) =>
      track.items
        .filter((item) => selectedIdSet.has(item.id))
        .map((item) => ({
          trackId: track.id,
          itemId: item.id,
          kind: item.kind as 'clip' | 'gap',
        })),
    );

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

    if (isMultiSelectionDrawerOpen.value || isLongPress.value || count > 1) {
      isClipPropertiesDrawerOpen.value = false;
      isMultiSelectionDrawerOpen.value = true;
    } else {
      isClipPropertiesDrawerOpen.value = true;
      isMultiSelectionDrawerOpen.value = false;
    }
  }

  function enterMobileMultiSelection(itemId: string) {
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
    isMultiSelectionMode,
    toggleMobileClipSelection,
    enterMobileMultiSelection,
  };
}
