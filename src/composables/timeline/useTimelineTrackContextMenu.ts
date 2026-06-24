import { computed, ref } from 'vue';
import type { TimelineTrack } from '~/timeline/types';
import { useTimelineStore } from '~/stores/timeline.store';
import { useAppClipboard } from '~/composables/useAppClipboard';
import { useTrackContextMenu } from '~/composables/timeline/useTrackContextMenu';
import type UiContextMenuPortal from '~/components/ui/UiContextMenuPortal.vue';

/**
 * Track-header context menu + rename modal wiring, extracted from
 * `TimelineTracks.vue`. Returns the template refs/handlers the SFC binds; the
 * `trackContextMenuRef` is assigned by the SFC's `ref="trackContextMenuRef"`.
 */
export function useTimelineTrackContextMenu(tracks: () => TimelineTrack[]) {
  const timelineStore = useTimelineStore();
  const clipboardStore = useAppClipboard();

  const isTrackRenameModalOpen = ref(false);
  const trackToRename = ref<TimelineTrack | null>(null);

  function handleRenameTrack(name: string) {
    if (trackToRename.value) {
      const trimmed = name.trim();
      if (trimmed && trimmed !== trackToRename.value.name) {
        timelineStore.renameTrack(trackToRename.value.id, trimmed);
      }
    }
    isTrackRenameModalOpen.value = false;
    trackToRename.value = null;
  }

  const { getTrackContextMenuItems } = useTrackContextMenu({
    onRequestDelete: (track) => timelineStore.deleteTrack(track.id, { allowNonEmpty: true }),
    onRequestRename: (track) => {
      trackToRename.value = track;
      isTrackRenameModalOpen.value = true;
    },
    onPaste: (trackId) => {
      const payload = clipboardStore.clipboardPayload;
      if (!payload || payload.source !== 'timeline' || payload.items.length === 0) return;
      void timelineStore.pasteClips(payload.items, {
        targetTrackId: trackId,
        insertStartUs: timelineStore.currentTime,
      });
      if (payload.operation === 'cut') clipboardStore.setClipboardPayload(null);
    },
  });

  const trackContextMenuRef = ref<InstanceType<typeof UiContextMenuPortal> | null>(null);
  const activeTrackForContextMenu = ref<TimelineTrack | null>(null);

  function onTrackContextMenu(e: MouseEvent, track: TimelineTrack) {
    activeTrackForContextMenu.value = track;
    trackContextMenuRef.value?.open(e);
  }

  function handleTrackContextMenu(e: MouseEvent, track: TimelineTrack) {
    const target = e.target as HTMLElement | null;
    if (target?.closest('[data-clip-id], [data-gap-id]')) {
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    onTrackContextMenu(e, track);
  }

  const activeTrackContextMenuItems = computed(() => {
    if (!activeTrackForContextMenu.value) return [];
    return getTrackContextMenuItems(activeTrackForContextMenu.value, tracks());
  });

  return {
    isTrackRenameModalOpen,
    trackToRename,
    handleRenameTrack,
    trackContextMenuRef,
    activeTrackContextMenuItems,
    handleTrackContextMenu,
  };
}
