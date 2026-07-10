import { computed } from 'vue';
import { useHotkeyLabel } from '~/composables/useHotkeyLabel';

interface MarkerLike {
  id: string;
}

interface UseTimelineRulerMenusOptions {
  t: ReturnType<typeof useI18n>['t'];
  timelineStore: {
    addMarkerAtPlayhead: () => void;
    addZoneMarkerAtPlayhead: () => void;
    addMarker: (
      input: { timeUs: number; durationUs?: number; text?: string; color?: string },
      options?: Record<string, unknown>,
    ) => void;
    createSelectionRangeAtPlayhead: () => void;
    createSelectionRange: (input: { startUs: number; endUs: number }) => void;
    convertZoneToMarker: (markerId: string) => void;
    convertMarkerToSelectionRange: (markerId: string) => void;
    createSelectionRangeFromMarker: (markerId: string) => void;
    convertMarkerToZone: (markerId: string) => void;
    convertSelectionRangeToMarker: () => void;
    rippleTrimSelectionRange: () => void;
    removeSelectionRange: () => void;
    getMarkers: () => MarkerLike[];
    defaultZoneDurationUs: number;
  };
  selectMarker: (markerId: string) => void;
  deleteMarker: (markerId: string) => void;
  getRightClickTimeUs?: () => number | null;
}

export function useTimelineRulerMenus(options: UseTimelineRulerMenusOptions) {
  const { getHotkeyTitle } = useHotkeyLabel();

  const rulerContextMenuItems = computed(() => [
    [
      {
        label: getHotkeyTitle(options.t('fastcat.timeline.addMarker'), 'general.addMarker'),
        icon: 'i-heroicons-bookmark',
        onSelect: () => {
          const timeUs = options.getRightClickTimeUs?.() ?? null;
          const existingIds = new Set(options.timelineStore.getMarkers().map((m) => m.id));
          if (timeUs !== null) {
            options.timelineStore.addMarker({ timeUs });
          } else {
            options.timelineStore.addMarkerAtPlayhead();
          }
          const created = options.timelineStore.getMarkers().find((m) => !existingIds.has(m.id));
          if (created) options.selectMarker(created.id);
        },
      },
      {
        label: options.t('fastcat.timeline.addZoneMarker'),
        icon: 'i-heroicons-arrows-right-left',
        onSelect: () => {
          const timeUs = options.getRightClickTimeUs?.() ?? null;
          const existingIds = new Set(options.timelineStore.getMarkers().map((m) => m.id));
          if (timeUs !== null) {
            options.timelineStore.addMarker({
              timeUs,
              durationUs: options.timelineStore.defaultZoneDurationUs,
            });
          } else {
            options.timelineStore.addZoneMarkerAtPlayhead();
          }
          const created = options.timelineStore.getMarkers().find((m) => !existingIds.has(m.id));
          if (created) options.selectMarker(created.id);
        },
      },
      {
        label: options.t('fastcat.timeline.createSelectionArea'),
        icon: 'i-heroicons-rectangle-group',
        onSelect: () => {
          const timeUs = options.getRightClickTimeUs?.() ?? null;
          if (timeUs !== null) {
            options.timelineStore.createSelectionRange({
              startUs: timeUs,
              endUs: timeUs + options.timelineStore.defaultZoneDurationUs,
            });
          } else {
            options.timelineStore.createSelectionRangeAtPlayhead();
          }
        },
      },
    ],
  ]);

  function getZoneMarkerMenuItems(markerId: string) {
    return [
      [
        {
          label: options.t('fastcat.timeline.convertZoneToMarker'),
          icon: 'i-heroicons-arrows-pointing-in',
          onSelect: () => options.timelineStore.convertZoneToMarker(markerId),
        },
        {
          label: options.t('fastcat.timeline.convertZoneToSelection'),
          icon: 'i-heroicons-rectangle-group',
          onSelect: () => options.timelineStore.convertMarkerToSelectionRange(markerId),
        },
        {
          label: options.t('fastcat.timeline.createSelectionFromZone'),
          icon: 'i-heroicons-sparkles',
          onSelect: () => options.timelineStore.createSelectionRangeFromMarker(markerId),
        },
        {
          label: getHotkeyTitle(options.t('fastcat.timeline.deleteMarker'), 'general.delete'),
          icon: 'i-heroicons-trash',
          color: 'red' as const,
          onSelect: () => options.deleteMarker(markerId),
        },
      ],
    ];
  }

  function getMarkerMenuItems(markerId: string) {
    return [
      [
        {
          label: options.t('fastcat.timeline.convertMarkerToZone'),
          icon: 'i-heroicons-arrows-pointing-out',
          onSelect: () => options.timelineStore.convertMarkerToZone(markerId),
        },
        {
          label: getHotkeyTitle(options.t('fastcat.timeline.deleteMarker'), 'general.delete'),
          icon: 'i-heroicons-trash',
          color: 'red' as const,
          onSelect: () => options.deleteMarker(markerId),
        },
      ],
    ];
  }

  const selectionRangeMenuItems = computed(() => [
    [
      {
        label: options.t('fastcat.timeline.convertSelectionToZoneMarker'),
        icon: 'i-heroicons-bookmark-square',
        onSelect: () => options.timelineStore.convertSelectionRangeToMarker(),
      },
      {
        label: options.t('fastcat.timeline.rippleTrimSelection'),
        icon: 'i-heroicons-scissors',
        onSelect: () => options.timelineStore.rippleTrimSelectionRange(),
      },
      {
        label: getHotkeyTitle(options.t('common.delete'), 'general.delete'),
        icon: 'i-heroicons-trash',
        color: 'red' as const,
        onSelect: () => options.timelineStore.removeSelectionRange(),
      },
    ],
  ]);

  return {
    rulerContextMenuItems,
    getZoneMarkerMenuItems,
    getMarkerMenuItems,
    selectionRangeMenuItems,
  };
}
