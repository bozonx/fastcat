import { computed } from 'vue';

interface MarkerLike {
  id: string;
}

interface UseTimelineRulerMenusOptions {
  t: ReturnType<typeof useI18n>['t'];
  timelineStore: {
    addMarkerAtPlayhead: () => void;
    addZoneMarkerAtPlayhead: () => void;
    createSelectionRangeAtPlayhead: () => void;
    convertZoneToMarker: (markerId: string) => void;
    convertMarkerToSelectionRange: (markerId: string) => void;
    createSelectionRangeFromMarker: (markerId: string) => void;
    convertMarkerToZone: (markerId: string) => void;
    convertSelectionRangeToMarker: () => void;
    rippleTrimSelectionRange: () => void;
    removeSelectionRange: () => void;
    getMarkers: () => MarkerLike[];
  };
  selectMarker: (markerId: string) => void;
  deleteMarker: (markerId: string) => void;
}

export function useTimelineRulerMenus(options: UseTimelineRulerMenusOptions) {
  const rulerContextMenuItems = computed(() => [
    [
      {
        label: options.t('fastcat.timeline.addMarkerAtPlayhead'),
        icon: 'i-heroicons-bookmark',
        onSelect: () => {
          options.timelineStore.addMarkerAtPlayhead();
          const latest = options.timelineStore.getMarkers().at(-1);
          if (latest) options.selectMarker(latest.id);
        },
      },
      {
        label: options.t('fastcat.timeline.addZoneMarkerAtPlayhead'),
        icon: 'i-heroicons-arrows-right-left',
        onSelect: () => {
          options.timelineStore.addZoneMarkerAtPlayhead();
          const latest = options.timelineStore.getMarkers().at(-1);
          if (latest) options.selectMarker(latest.id);
        },
      },
      {
        label: options.t('fastcat.timeline.createSelectionArea'),
        icon: 'i-heroicons-rectangle-group',
        onSelect: () => {
          options.timelineStore.createSelectionRangeAtPlayhead();
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
          label: options.t('fastcat.timeline.deleteMarker'),
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
          label: options.t('fastcat.timeline.deleteMarker'),
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
        label: options.t('common.delete'),
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
