import { computed, type Ref } from 'vue';
import type { useProjectStore } from '~/stores/project.store';
import type { useTimelineStore } from '~/stores/timeline.store';
import type { useSelectionStore } from '~/stores/selection.store';

interface PlaybackSpeedOption {
  label: string;
  value: number;
}

interface PreviewResolutionOption {
  label: string;
  value: number;
  isProject: boolean;
}

type TranslateFn = (key: string, fallback?: string) => string;

interface MonitorViewportPublicApi {
  centerMonitor: () => void;
  resetZoom: () => void;
  resetView: () => void;
}

interface UseMonitorContainerControlsOptions {
  t: TranslateFn;
  projectStore: ReturnType<typeof useProjectStore>;
  timelineStore: ReturnType<typeof useTimelineStore>;
  selectionStore: ReturnType<typeof useSelectionStore>;
  viewportRef: Ref<MonitorViewportPublicApi | null>;
  videoItems: Ref<unknown[]>;
  isLoading: Ref<boolean>;
  loadError: Ref<string | null>;
  safeDurationUs: Ref<number>;
  previewEffectsEnabled: Ref<boolean>;
  useProxyInMonitor: Ref<boolean>;
  showGrid: Ref<boolean>;
  isSavingStopFrame: Ref<boolean>;
  createStopFrameSnapshot: () => Promise<void>;
  scheduleBuild: () => void;
  toggleGrid: () => void;
}

export function useMonitorContainerControls(options: UseMonitorContainerControlsOptions) {
  const playbackSpeedOptions: PlaybackSpeedOption[] = [
    { label: '0.5x', value: 0.5 },
    { label: '0.75x', value: 0.75 },
    { label: '1x', value: 1 },
    { label: '1.25x', value: 1.25 },
    { label: '1.5x', value: 1.5 },
    { label: '1.75x', value: 1.75 },
    { label: '2x', value: 2 },
    { label: '3x', value: 3 },
    { label: '5x', value: 5 },
  ];

  const canInteractPlayback = computed(
    () =>
      !options.isLoading.value &&
      (options.safeDurationUs.value > 0 || options.videoItems.value.length > 0),
  );

  const selectedPlaybackSpeedOption = computed(() => {
    const absSpeed = Math.abs(options.timelineStore.playbackSpeed);
    return (
      playbackSpeedOptions.find((option) => option.value === absSpeed) ?? playbackSpeedOptions[2]
    );
  });

  const previewResolutions = computed<PreviewResolutionOption[]>(() => {
    const projectHeight = options.projectStore.projectSettings.project.height;
    const baseResolutions = [2160, 1440, 1080, 720, 480, 360, 240, 144];

    return baseResolutions.map((value) => ({
      label: `${value}p`,
      value,
      isProject: value === projectHeight,
    }));
  });

  const toolbarPosition = computed(
    () => options.projectStore.activeMonitor?.toolbarPosition ?? 'bottom',
  );

  function blurActiveElement() {
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  function centerMonitor() {
    options.viewportRef.value?.centerMonitor();
  }

  function resetZoom() {
    options.viewportRef.value?.resetZoom();
  }

  function resetView() {
    options.viewportRef.value?.resetView();
  }

  function setToolbarPosition(position: 'top' | 'right' | 'bottom' | 'left') {
    if (!options.projectStore.activeMonitor) {
      return;
    }

    options.projectStore.activeMonitor.toolbarPosition = position;
  }

  function togglePreviewEffects() {
    if (!options.projectStore.activeMonitor) {
      return;
    }

    options.projectStore.activeMonitor.previewEffectsEnabled = !options.previewEffectsEnabled.value;
  }

  function toggleProxyUsage() {
    if (!options.projectStore.activeMonitor) {
      return;
    }

    options.projectStore.activeMonitor.useProxy = !options.useProxyInMonitor.value;
  }

  function togglePlayback() {
    if (options.isLoading.value) {
      return;
    }

    if (options.loadError.value) {
      options.loadError.value = null;
      options.scheduleBuild();
      return;
    }

    options.timelineStore.togglePlayback();
  }

  function setPlayback(params: { direction: 'forward' | 'backward'; speed: number }) {
    if (options.isLoading.value || !canInteractPlayback.value) {
      return;
    }

    const finalSpeed = params.direction === 'backward' ? -params.speed : params.speed;
    if (options.timelineStore.isPlaying && options.timelineStore.playbackSpeed === finalSpeed) {
      options.timelineStore.togglePlayback();
      blurActiveElement();
      return;
    }

    options.timelineStore.setPlaybackSpeed(finalSpeed);
    if (!options.timelineStore.isPlaying) {
      options.timelineStore.togglePlayback();
    }

    blurActiveElement();
  }

  function rewindToStart() {
    options.timelineStore.setCurrentTimeUs(0);
    blurActiveElement();
  }

  function onPlaybackSpeedChange(value: PlaybackSpeedOption | number | null | undefined) {
    if (!value) {
      return;
    }

    const speed = Number(typeof value === 'number' ? value : value.value);
    const direction = options.timelineStore.playbackSpeed < 0 ? -1 : 1;
    options.timelineStore.setPlaybackSpeed(speed * direction);
  }

  function handleSpeedWheel(event: WheelEvent) {
    if (!canInteractPlayback.value) {
      return;
    }

    const currentAbsSpeed = Math.abs(options.timelineStore.playbackSpeed);
    const currentIndex = playbackSpeedOptions.findIndex(
      (option) => option.value === currentAbsSpeed,
    );
    const index = currentIndex >= 0 ? currentIndex : 2;

    let nextIndex = index;
    if (event.deltaY < 0) {
      nextIndex = Math.min(playbackSpeedOptions.length - 1, index + 1);
    } else if (event.deltaY > 0) {
      nextIndex = Math.max(0, index - 1);
    }

    if (nextIndex === index) {
      return;
    }

    const nextSpeed = playbackSpeedOptions[nextIndex]?.value;
    if (!nextSpeed) {
      return;
    }

    const direction = options.timelineStore.playbackSpeed < 0 ? -1 : 1;
    options.timelineStore.setPlaybackSpeed(nextSpeed * direction);
  }

  function createMarkerAtPlayhead() {
    const existingMarkers = options.timelineStore.getMarkers();
    options.timelineStore.addMarkerAtPlayhead();
    const nextMarkers = options.timelineStore.getMarkers();
    const createdMarker =
      nextMarkers.find((marker) => !existingMarkers.some((item) => item.id === marker.id)) ??
      nextMarkers[nextMarkers.length - 1];

    if (createdMarker) {
      options.selectionStore.selectTimelineMarker(createdMarker.id);
    }
  }

  const contextMenuItems = computed(() => [
    [
      {
        label: options.t('fastcat.preview.resetZoom', 'Reset Zoom & Pan'),
        icon: 'i-heroicons-arrow-path',
        onSelect: resetView,
      },
      {
        label: options.showGrid.value
          ? options.t('fastcat.monitor.hideGrid', 'Hide grid')
          : options.t('fastcat.monitor.showGrid', 'Show grid'),
        icon: options.showGrid.value ? 'i-heroicons-check' : 'i-heroicons-squares-2x2',
        onSelect: options.toggleGrid,
      },
      {
        label: options.t('fastcat.monitor.snapshot', 'Create snapshot'),
        icon: 'i-heroicons-camera',
        onSelect: options.createStopFrameSnapshot,
        disabled:
          options.isSavingStopFrame.value ||
          options.isLoading.value ||
          Boolean(options.loadError.value),
      },
    ],
    [
      {
        label: options.t('fastcat.monitor.toolbarTop', 'Панель сверху'),
        icon: toolbarPosition.value === 'top' ? 'i-heroicons-check' : undefined,
        onSelect: () => setToolbarPosition('top'),
      },
      {
        label: options.t('fastcat.monitor.toolbarRight', 'Панель справа'),
        icon: toolbarPosition.value === 'right' ? 'i-heroicons-check' : undefined,
        onSelect: () => setToolbarPosition('right'),
      },
      {
        label: options.t('fastcat.monitor.toolbarBottom', 'Панель снизу'),
        icon: toolbarPosition.value === 'bottom' ? 'i-heroicons-check' : undefined,
        onSelect: () => setToolbarPosition('bottom'),
      },
      {
        label: options.t('fastcat.monitor.toolbarLeft', 'Панель слева'),
        icon: toolbarPosition.value === 'left' ? 'i-heroicons-check' : undefined,
        onSelect: () => setToolbarPosition('left'),
      },
    ],
  ]);

  return {
    canInteractPlayback,
    centerMonitor,
    contextMenuItems,
    createMarkerAtPlayhead,
    handleSpeedWheel,
    onPlaybackSpeedChange,
    playbackSpeedOptions,
    previewResolutions,
    resetZoom,
    rewindToStart,
    selectedPlaybackSpeedOption,
    setPlayback,
    togglePlayback,
    togglePreviewEffects,
    toggleProxyUsage,
    toolbarPosition,
  };
}
