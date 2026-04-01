import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useTimelineSettingsStore } from '~/stores/timeline-settings.store';
import { useSelectionStore } from '~/stores/selection.store';

export function useTimelineEmptyAreaContextMenu(options: { onZoomToFit?: () => void } = {}) {
  const { t } = useI18n();
  const timelineStore = useTimelineStore();
  const timelineSettingsStore = useTimelineSettingsStore();
  const selectionStore = useSelectionStore();

  const emptyAreaContextMenuItems = computed(() => [
    [
      {
        label: t('fastcat.timeline.properties.title'),
        icon: 'i-heroicons-cog-6-tooth',
        onSelect: () => {
          timelineStore.selectTimelineProperties();
          selectionStore.selectTimelineProperties();
        },
      },
      {
        label: t('fastcat.timeline.zoomToFit'),
        icon: 'i-heroicons-arrows-pointing-out',
        onSelect: () => {
          if (options.onZoomToFit) {
            options.onZoomToFit();
          } else {
            timelineStore.fitTimelineZoom();
          }
        },
      },
      {
        label: t('fastcat.timeline.properties.snapSettings'),
        icon: 'i-heroicons-link',
        onSelect: () => {
          timelineSettingsStore.isSnapSettingsModalOpen = true;
        },
      },
    ],
  ]);

  return {
    emptyAreaContextMenuItems,
  };
}
