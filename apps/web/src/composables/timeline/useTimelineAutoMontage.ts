import { ref, watch } from 'vue';
import type { TimelineClipActionPayload, TimelineTrack } from '~/timeline/types';
import { useUiStore } from '~/stores/ui.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useSilenceTrimming } from '~/composables/timeline/useSilenceTrimming';

/**
 * State + handlers for the auto-montage (silence trimming) modal, extracted from
 * `TimelineTracks.vue`. Watches the global trigger and only opens when at least
 * one targeted item belongs to the currently rendered tracks.
 */
export function useTimelineAutoMontage(tracks: () => TimelineTrack[]) {
  const uiStore = useUiStore();
  const selectionStore = useSelectionStore();
  const { applySilenceTrimming } = useSilenceTrimming();

  const autoMontageModal = ref<{ open: boolean; itemIds: string[] } | null>(null);

  async function applyAutoMontage(settings: {
    trimStart: boolean;
    trimEnd: boolean;
    trimMiddle: boolean;
    mode: 'cut' | 'mark';
  }) {
    if (!autoMontageModal.value) return;
    await applySilenceTrimming({
      clipIds: autoMontageModal.value.itemIds,
      settings,
    });
  }

  watch(
    () => uiStore.openAutoMontageTrigger,
    (val) => {
      if (!val) return;
      const hasAnyItem = tracks().some((track) =>
        track.items.some((item) => val.itemIds.includes(item.id)),
      );
      if (!hasAnyItem) return;
      autoMontageModal.value = {
        open: true,
        itemIds: val.itemIds,
      };
    },
  );

  function openAutoMontage(payload: TimelineClipActionPayload) {
    const entity = selectionStore.selectedEntity;
    let itemIds: string[] = [payload.itemId];

    if (entity?.source === 'timeline' && entity.kind === 'clips') {
      const ids = entity.items.map((it) => it.itemId);
      if (ids.includes(payload.itemId)) {
        itemIds = ids;
      }
    }

    autoMontageModal.value = {
      open: true,
      itemIds,
    };
  }

  return {
    autoMontageModal,
    applyAutoMontage,
    openAutoMontage,
  };
}
