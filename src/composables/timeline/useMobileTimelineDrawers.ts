import { ref, watch, computed, nextTick, type Ref } from 'vue';
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
  const isMultiSelectionDrawerOpen = ref(false);
  const isAddContentDrawerOpen = ref(false);
  const isTrimDrawerOpen = ref(false);
  const isTransitionsPanelOpen = ref(false);
  const isDeleteDrawerOpen = ref(false);
  const isVirtualClipPresetDrawerOpen = ref(false);
  const isSettingsDrawerOpen = ref(false);
  const isTrackMixerDrawerOpen = ref(false);
  const isHistoryDrawerOpen = ref(false);
  const isMarkersDrawerOpen = ref(false);
  const isTrackManagerDrawerOpen = ref(false);
  const virtualClipPresetType = ref<'text' | 'shape' | 'hud'>('text');
  const drawerActiveSnapPoint = ref<string | number | null>(null);

  const isLongPress = ref(false);
  const suppressDrawerSelectionClear = ref(false);

  // Single source of truth for "which drawers exist". `closeAllDrawers` and
  // `isAnyDrawerOpen` both derive from this list so they can never drift apart.
  const allDrawerOpenRefs: Ref<boolean>[] = [
    isTrackPropertiesDrawerOpen,
    isClipPropertiesDrawerOpen,
    isMarkerPropertiesDrawerOpen,
    isSelectionRangeDrawerOpen,
    isMultiSelectionDrawerOpen,
    isTrimDrawerOpen,
    isTransitionsPanelOpen,
    isDeleteDrawerOpen,
    isAddContentDrawerOpen,
    isVirtualClipPresetDrawerOpen,
    isSettingsDrawerOpen,
    isTrackMixerDrawerOpen,
    isHistoryDrawerOpen,
    isMarkersDrawerOpen,
    isTrackManagerDrawerOpen,
  ];

  const isAnyDrawerOpen = computed(() => allDrawerOpenRefs.some((r) => r.value));

  function closeAllDrawers() {
    for (const drawerOpen of allDrawerOpenRefs) {
      drawerOpen.value = false;
    }
  }

  /**
   * Open a toolbar drawer exclusively: any other open drawer (selection-driven or
   * toolbar) is closed first so only a single drawer is ever visible at a time.
   */
  function openTrackMixerDrawer() {
    closeAllDrawers();
    isTrackMixerDrawerOpen.value = true;
  }

  function openTrackManagerDrawer() {
    closeAllDrawers();
    isTrackManagerDrawerOpen.value = true;
  }

  function openHistoryDrawer() {
    closeAllDrawers();
    isHistoryDrawerOpen.value = true;
  }

  function openMarkersDrawer() {
    closeAllDrawers();
    isMarkersDrawerOpen.value = true;
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
      if (isTrimDrawerOpen.value || isTransitionsPanelOpen.value || isDeleteDrawerOpen.value)
        return;
      if (suppressDrawerSelectionClear.value) return;

      const { trackId, itemIds, entity, transition, markerId, gap } = state;

      if (isLongPress.value) return;

      if (isMultiSelectionDrawerOpen.value && itemIds.length > 0) return;

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

  async function suppressDrawerSelectionClearTemporarily(callback?: () => void) {
    suppressDrawerSelectionClear.value = true;

    try {
      callback?.();
    } finally {
      await nextTick();
      suppressDrawerSelectionClear.value = false;
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

  /** Clear the active clip selection (timeline + selection stores) if a clip is selected. */
  function clearClipSelectionIfActive() {
    if (selectionStore.selectedEntity?.kind === 'clip') {
      timelineStore.clearSelection();
      selectionStore.clearSelection();
    }
  }

  // ─── Clip sub-drawer transitions (delete / trim / transitions panel) ───
  // Opening a sub-drawer hides the clip-properties drawer; "back" reverses it.
  function openClipDeleteDrawer() {
    isDeleteDrawerOpen.value = true;
    isClipPropertiesDrawerOpen.value = false;
  }

  function openClipTrimDrawer() {
    isTrimDrawerOpen.value = true;
    isClipPropertiesDrawerOpen.value = false;
  }

  function openClipTransitionsPanel() {
    isTransitionsPanelOpen.value = true;
    isClipPropertiesDrawerOpen.value = false;
  }

  function backToClipProperties() {
    isDeleteDrawerOpen.value = false;
    isTrimDrawerOpen.value = false;
    isTransitionsPanelOpen.value = false;
    isClipPropertiesDrawerOpen.value = true;
  }

  function onClipPropertiesDrawerClose() {
    isClipPropertiesDrawerOpen.value = false;
    isLongPress.value = false;

    if (suppressDrawerSelectionClear.value) {
      return;
    }

    clearClipSelectionIfActive();
  }

  function onClipTrimDrawerClose() {
    isTrimDrawerOpen.value = false;
    clearClipSelectionIfActive();
  }

  function onTransitionsPanelClose() {
    isTransitionsPanelOpen.value = false;
    clearClipSelectionIfActive();
  }

  function onClipDeleteDrawerClose() {
    isDeleteDrawerOpen.value = false;
    clearClipSelectionIfActive();
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
    if (
      selectionStore.selectedEntity?.kind === 'marker' ||
      selectionStore.selectedEntity?.kind === 'markers'
    ) {
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

  function onOpenVirtualClipPreset(type: 'text' | 'shape' | 'hud') {
    virtualClipPresetType.value = type;
    // Defer opening one tick so the drawer mounts with the updated preset type.
    void nextTick(() => {
      isVirtualClipPresetDrawerOpen.value = true;
    });
  }

  return {
    isTrackPropertiesDrawerOpen,
    isClipPropertiesDrawerOpen,
    isMarkerPropertiesDrawerOpen,
    isSelectionRangeDrawerOpen,
    isMultiSelectionDrawerOpen,
    isAddContentDrawerOpen,
    isTrimDrawerOpen,
    isTransitionsPanelOpen,
    isDeleteDrawerOpen,
    isVirtualClipPresetDrawerOpen,
    isSettingsDrawerOpen,
    isTrackMixerDrawerOpen,
    isHistoryDrawerOpen,
    isMarkersDrawerOpen,
    isTrackManagerDrawerOpen,
    virtualClipPresetType,
    drawerActiveSnapPoint,
    isLongPress,
    isAnyDrawerOpen,
    suppressDrawerSelectionClear,
    suppressDrawerSelectionClearTemporarily,
    closeAllDrawers,
    openTrackMixerDrawer,
    openTrackManagerDrawer,
    openHistoryDrawer,
    openMarkersDrawer,
    openClipDeleteDrawer,
    openClipTrimDrawer,
    openClipTransitionsPanel,
    backToClipProperties,
    onUpdateDrawerOpen,
    onClipPropertiesDrawerClose,
    onClipTrimDrawerClose,
    onTransitionsPanelClose,
    onClipDeleteDrawerClose,
    onMultiSelectionDrawerClose,
    onMarkerPropertiesDrawerClose,
    onSelectionRangeDrawerClose,
    onOpenVirtualClipPreset,
  };
}
