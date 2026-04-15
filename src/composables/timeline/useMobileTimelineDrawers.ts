import { ref, watch, computed, onBeforeUnmount } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';

export function useMobileTimelineDrawers() {
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

  const selectedGap = computed(() => {
    const entity = selectionStore.selectedEntity;
    if (entity?.source !== 'timeline' || entity.kind !== 'gap') return null;
    return { trackId: entity.trackId, itemId: entity.itemId };
  });

  const isTrackPropertiesDrawerOpen = ref(false);
  const isClipPropertiesDrawerOpen = ref(false);
  const isMarkerPropertiesDrawerOpen = ref(false);
  const isSelectionRangeDrawerOpen = ref(false);
  const isTransitionDrawerOpen = ref(false);
  const isMultiSelectionDrawerOpen = ref(false);
  const isAddContentDrawerOpen = ref(false);
  const isTrimDrawerOpen = ref(false);
  const isVirtualClipPresetDrawerOpen = ref(false);
  const isSettingsDrawerOpen = ref(false);
  const isTrackMixerDrawerOpen = ref(false);
  const isHistoryDrawerOpen = ref(false);
  const isMarkersDrawerOpen = ref(false);
  const virtualClipPresetType = ref<'text' | 'shape' | 'hud'>('text');
  const drawerActiveSnapPoint = ref<string | number | null>(null);

  const isLongPress = ref(false);
  const suppressDrawerSelectionClear = ref(false);
  let suppressDrawerSelectionClearResetTimer: ReturnType<typeof setTimeout> | null = null;

  function closeAllDrawers() {
    isTrackPropertiesDrawerOpen.value = false;
    isClipPropertiesDrawerOpen.value = false;
    isMarkerPropertiesDrawerOpen.value = false;
    isSelectionRangeDrawerOpen.value = false;
    isTransitionDrawerOpen.value = false;
    isMultiSelectionDrawerOpen.value = false;
    isTrimDrawerOpen.value = false;
    isSettingsDrawerOpen.value = false;
  }

  watch(
    () => ({
      trackId: timelineStore.selectedTrackId,
      itemIds: timelineStore.selectedItemIds,
      entity: selectionStore.selectedEntity,
      transition: timelineStore.selectedTransition,
      markerId: selectedMarkerId.value,
      gap: selectedGap.value,
    }),
    (state) => {
      const { trackId, itemIds, entity, transition, markerId, gap } = state;

      if (isLongPress.value) return;

      if (isMultiSelectionDrawerOpen.value && itemIds.length > 0) return;

      if (transition) {
        closeAllDrawers();
        isTransitionDrawerOpen.value = true;
        return;
      }

      if (entity?.kind === 'timeline-properties' && entity.source === 'timeline') {
        closeAllDrawers();
        drawerActiveSnapPoint.value = 0.92;
        isSettingsDrawerOpen.value = true;
        return;
      }

      if (markerId) {
        closeAllDrawers();
        isMarkerPropertiesDrawerOpen.value = true;
        return;
      }

      if (entity?.source === 'timeline' && entity.kind === 'selection-range') {
        if (!isSelectionRangeDrawerOpen.value) {
          closeAllDrawers();
          isSelectionRangeDrawerOpen.value = true;
        }
        return;
      }

      if (gap) {
        if (!isTrackPropertiesDrawerOpen.value) {
          closeAllDrawers();
          isTrackPropertiesDrawerOpen.value = true;
        }
        return;
      }

      if (itemIds.length > 0 && !gap) {
        if (itemIds.length > 1) {
          if (!isMultiSelectionDrawerOpen.value) {
            closeAllDrawers();
            isMultiSelectionDrawerOpen.value = true;
          }
        } else {
          if (!isClipPropertiesDrawerOpen.value) {
            closeAllDrawers();
            isClipPropertiesDrawerOpen.value = true;
          }
        }
        return;
      }

      if (trackId && itemIds.length === 0 && !gap) {
        if (!isTrackPropertiesDrawerOpen.value) {
          closeAllDrawers();
          isTrackPropertiesDrawerOpen.value = true;
        }
        return;
      }

      closeAllDrawers();
    },
    { immediate: true, deep: false },
  );

  function suppressDrawerSelectionClearTemporarily(callback?: () => void) {
    suppressDrawerSelectionClear.value = true;

    if (suppressDrawerSelectionClearResetTimer !== null) {
      clearTimeout(suppressDrawerSelectionClearResetTimer);
    }

    try {
      callback?.();
    } finally {
      suppressDrawerSelectionClearResetTimer = setTimeout(() => {
        suppressDrawerSelectionClear.value = false;
        suppressDrawerSelectionClearResetTimer = null;
      }, 0);
    }
  }

  function onUpdateDrawerOpen(val: boolean) {
    if (!val) {
      if (timelineStore.selectedTrackId) {
        timelineStore.selectTrack(null);
      }
      isLongPress.value = false;
    }
  }

  function onClipPropertiesDrawerClose() {
    isClipPropertiesDrawerOpen.value = false;
    isLongPress.value = false;

    if (suppressDrawerSelectionClear.value) {
      return;
    }

    if (selectionStore.selectedEntity?.kind === 'clip') {
      timelineStore.clearSelection();
      selectionStore.clearSelection();
    }
  }

  function onClipTrimDrawerClose() {
    isTrimDrawerOpen.value = false;
    if (selectionStore.selectedEntity?.kind === 'clip') {
      timelineStore.clearSelection();
      selectionStore.clearSelection();
    }
  }

  function onMultiSelectionDrawerClose() {
    isMultiSelectionDrawerOpen.value = false;
    isLongPress.value = false;

    if (suppressDrawerSelectionClear.value) {
      return;
    }

    if (selectionStore.selectedEntity?.kind === 'clips') {
      timelineStore.clearSelection();
      selectionStore.clearSelection();
    }
  }

  function onMarkerPropertiesDrawerClose() {
    isMarkerPropertiesDrawerOpen.value = false;

    if (suppressDrawerSelectionClear.value) {
      return;
    }
    if (selectionStore.selectedEntity?.kind === 'marker') {
      selectionStore.clearSelection();
    }
  }

  function onSelectionRangeDrawerClose() {
    isSelectionRangeDrawerOpen.value = false;

    if (suppressDrawerSelectionClear.value) {
      return;
    }
    if (selectionStore.selectedEntity?.kind === 'selection-range') {
      selectionStore.clearSelection();
    }
  }

  function onTransitionDrawerClose() {
    isTransitionDrawerOpen.value = false;

    if (suppressDrawerSelectionClear.value) {
      return;
    }
    if (selectionStore.selectedEntity?.kind === 'transition') {
      timelineStore.selectTransition(null);
      selectionStore.clearSelection();
    }
  }

  function onOpenVirtualClipPreset(type: 'text' | 'shape' | 'hud') {
    virtualClipPresetType.value = type;
    setTimeout(() => {
      isVirtualClipPresetDrawerOpen.value = true;
    }, 0);
  }


  onBeforeUnmount(() => {
    if (suppressDrawerSelectionClearResetTimer !== null) {
      clearTimeout(suppressDrawerSelectionClearResetTimer);
    }
  });

  return {
    isTrackPropertiesDrawerOpen,
    isClipPropertiesDrawerOpen,
    isMarkerPropertiesDrawerOpen,
    isSelectionRangeDrawerOpen,
    isTransitionDrawerOpen,
    isMultiSelectionDrawerOpen,
    isAddContentDrawerOpen,
    isTrimDrawerOpen,
    isVirtualClipPresetDrawerOpen,
    isSettingsDrawerOpen,
    isTrackMixerDrawerOpen,
    isHistoryDrawerOpen,
    isMarkersDrawerOpen,
    virtualClipPresetType,
    drawerActiveSnapPoint,
    isLongPress,
    suppressDrawerSelectionClear,
    suppressDrawerSelectionClearTemporarily,
    suppressDrawerSelectionClearResetTimer,
    closeAllDrawers,
    onUpdateDrawerOpen,
    onClipPropertiesDrawerClose,
    onClipTrimDrawerClose,
    onMultiSelectionDrawerClose,
    onMarkerPropertiesDrawerClose,
    onSelectionRangeDrawerClose,
    onTransitionDrawerClose,
    onOpenVirtualClipPreset,
  };
}
