import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';

/**
 * Derived timeline-selection entities shared by the mobile drawer/selection
 * composables: the currently selected marker id and the selected gap reference.
 */
export function useTimelineSelectionEntities() {
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

  return { selectedMarkerId, selectedGap };
}
