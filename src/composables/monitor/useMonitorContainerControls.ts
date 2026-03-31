import { computed, type Ref } from 'vue';
import { useMonitorSettings } from '~/composables/monitor/useMonitorSettings';
import type { useProjectStore } from '~/stores/project.store';
import type { useTimelineStore } from '~/stores/timeline.store';
import type { useSelectionStore } from '~/stores/selection.store';

interface PlaybackSpeedOption {
  label: string;
  value: number;
}

interface PreviewResolutionOption {
  label: string;
  shortLabel: string;
  value: number;
  isProject: boolean;
}

type TranslateFn = (key: string, fallback?: string) => string;

interface MonitorViewportPublicApi {
  centerMonitor: () => void;
  resetZoom: () => void;
  resetView: () => void;
  fitMonitor: () => void;
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
  isMobile?: boolean;
}

function formatSpeedLabel(speed: number): string {
  const abs = Math.abs(speed);
  const prefix = speed < 0 ? '-' : '';
  // Show "x" suffix only for ±1
  if (abs === 1) return `${prefix}1x`;
  return `${prefix}${abs}`;
}

export function useMonitorContainerControls(options: UseMonitorContainerControlsOptions) {
  const { showTimecode } = useMonitorSettings();
  const positiveSpeedValues = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3, 5];

  const playbackSpeedOptions: PlaybackSpeedOption[] = positiveSpeedValues.map((v) => ({
    label: formatSpeedLabel(v),
    value: v,
  }));

  // Negative speeds in descending order (fastest to slowest: -5 … -0.5)
  const negativeSpeedOptions: PlaybackSpeedOption[] = positiveSpeedValues
    .slice()
    .reverse()
    .map((v) => ({ label: formatSpeedLabel(-v), value: -v }));

  // Full list used for mouse-wheel traversal: most-negative → most-positive
  const wheelSpeedList: PlaybackSpeedOption[] = [...negativeSpeedOptions, ...playbackSpeedOptions];

  const canInteractPlayback = computed(
    () =>
      !options.isLoading.value &&
      (options.safeDurationUs.value > 0 || options.videoItems.value.length > 0),
  );

  const selectedPlaybackSpeedOption = computed(() => {
    const speed = options.timelineStore.playbackSpeed;
    return (
      wheelSpeedList.find((opt) => opt.value === speed) ??
      playbackSpeedOptions.find((opt) => opt.value === 1)!
    );
  });

  /** Label displayed on the play button badge (e.g. "1x", "-1x", "0.5", "-2") */
  const speedButtonLabel = computed(() => formatSpeedLabel(options.timelineStore.playbackSpeed));

  const previewResolutions = computed<PreviewResolutionOption[]>(() => {
    const projectHeight = Math.max(
      1,
      Math.round(options.projectStore.projectSettings.project.height),
    );

    // Standard fractional preview resolutions (Full, 1/2, 1/4, 1/8)
    const scales = [1, 0.5, 0.25, 0.125];

    return scales.map((scale) => {
      const height = Math.max(1, Math.round((projectHeight * scale) / 2) * 2);

      const shortLabel = scale === 1 ? '1/1' : `1/${1 / scale}`;
      let label = shortLabel;

      // Append absolute height for clarity
      label += ` (${height}p)`;

      return {
        label,
        shortLabel,
        value: scale, // Stored as scale factor
        isProject: scale === 1,
      };
    });
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

  function fitMonitor() {
    options.viewportRef.value?.fitMonitor();
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

  /**
   * Start playback at the given signed speed, or stop if already playing at that speed.
   * Negative speed = play backward.
   */
  function setPlayback(signedSpeed: number) {
    if (options.isLoading.value || !canInteractPlayback.value) {
      return;
    }

    const speed = signedSpeed || 1;
    if (options.timelineStore.isPlaying && options.timelineStore.playbackSpeed === speed) {
      options.timelineStore.togglePlayback();
      blurActiveElement();
      return;
    }

    options.timelineStore.setPlaybackSpeed(speed);
    if (!options.timelineStore.isPlaying) {
      options.timelineStore.togglePlayback();
    }

    blurActiveElement();
  }

  function rewindToStart() {
    options.timelineStore.setCurrentTimeUs(0);
    blurActiveElement();
  }

  function rewindToEnd() {
    options.timelineStore.setCurrentTimeUs(options.safeDurationUs.value);
    blurActiveElement();
  }

  function handleBoundaryWheel(event: WheelEvent, invertVertical = false) {
    if (!canInteractPlayback.value) return;
    const dy = invertVertical ? -event.deltaY : event.deltaY;
    if (dy < 0) {
      options.timelineStore.jumpToNextClipBoundary();
    } else if (dy > 0) {
      options.timelineStore.jumpToPrevClipBoundary();
    }
  }

  function handleEndBoundaryWheel(event: WheelEvent) {
    handleBoundaryWheel(event, true);
  }

  function onPlaybackSpeedChange(value: PlaybackSpeedOption | number | null | undefined) {
    if (!value) {
      return;
    }

    // Value already carries the sign (negative = backward)
    const speed = Number(typeof value === 'number' ? value : value.value);
    options.timelineStore.setPlaybackSpeed(speed);
  }

  function handleSpeedWheel(event: WheelEvent) {
    if (!canInteractPlayback.value) {
      return;
    }

    const currentSpeed = options.timelineStore.playbackSpeed;
    const currentIndex = wheelSpeedList.findIndex((opt) => opt.value === currentSpeed);
    // Default to 1x forward if not found
    const defaultIndex = wheelSpeedList.findIndex((opt) => opt.value === 1);
    const index = currentIndex >= 0 ? currentIndex : defaultIndex;

    let nextIndex = index;
    if (event.deltaY < 0) {
      nextIndex = Math.min(wheelSpeedList.length - 1, index + 1);
    } else if (event.deltaY > 0) {
      nextIndex = Math.max(0, index - 1);
    }

    if (nextIndex === index) {
      return;
    }

    const nextOption = wheelSpeedList[nextIndex];
    if (!nextOption) {
      return;
    }

    options.timelineStore.setPlaybackSpeed(nextOption.value);
  }

  function createMarkerAtPlayhead() {
    const existingMarkers = options.timelineStore.markers;
    options.timelineStore.addMarkerAtPlayhead();
    const nextMarkers = options.timelineStore.markers;
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
        label: options.t('fastcat.timeline.addMarkerAtPlayhead'),
        icon: 'i-heroicons-tag',
        onSelect: createMarkerAtPlayhead,
      },
      {
        label: options.t('fastcat.monitor.snapshot'),
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
        label: options.t('fastcat.preview.fitToWindow'),
        icon: 'i-heroicons-arrows-pointing-in',
        onSelect: fitMonitor,
      },
      {
        label: options.t('fastcat.monitor.center'),
        icon: 'i-lucide-crosshair',
        onSelect: centerMonitor,
      },
      {
        label: options.t('fastcat.preview.resetZoom'),
        icon: 'i-heroicons-arrow-path',
        onSelect: resetView,
      },
    ],
    [
      {
        label: options.t('fastcat.monitor.showGrid'),
        icon: 'i-heroicons-squares-2x2',
        type: 'checkbox' as const,
        checked: options.showGrid.value,
        onSelect: options.toggleGrid,
      },
      {
        label: options.t('fastcat.monitor.showTimecode', 'Show Timecode'),
        icon: 'i-heroicons-clock',
        type: 'checkbox' as const,
        checked: showTimecode.value,
        onSelect: () => {
          showTimecode.value = !showTimecode.value;
        },
      },
      ...(options.isMobile
        ? [
            {
              label: options.t('fastcat.monitor.previewWithEffects', 'Preview Effects'),
              icon: 'i-heroicons-sparkles',
              type: 'checkbox' as const,
              checked: options.previewEffectsEnabled.value,
              onSelect: togglePreviewEffects,
            },
            {
              label: options.t('fastcat.monitor.useProxy', 'Use Proxy'),
              icon: 'i-heroicons-bolt',
              type: 'checkbox' as const,
              checked: options.useProxyInMonitor.value,
              onSelect: toggleProxyUsage,
            },
          ]
        : []),
    ],
    ...(options.isMobile
      ? []
      : [
          [
            {
              label: options.t('fastcat.monitor.toolbarTop'),
              icon: 'i-lucide-panel-top',
              type: 'checkbox' as const,
              checked: toolbarPosition.value === 'top',
              onSelect: () => setToolbarPosition('top'),
            },
            {
              label: options.t('fastcat.monitor.toolbarRight'),
              icon: 'i-lucide-panel-right',
              type: 'checkbox' as const,
              checked: toolbarPosition.value === 'right',
              onSelect: () => setToolbarPosition('right'),
            },
            {
              label: options.t('fastcat.monitor.toolbarBottom'),
              icon: 'i-lucide-panel-bottom',
              type: 'checkbox' as const,
              checked: toolbarPosition.value === 'bottom',
              onSelect: () => setToolbarPosition('bottom'),
            },
            {
              label: options.t('fastcat.monitor.toolbarLeft'),
              icon: 'i-lucide-panel-left',
              type: 'checkbox' as const,
              checked: toolbarPosition.value === 'left',
              onSelect: () => setToolbarPosition('left'),
            },
          ],
        ]),
    previewResolutions.value.map((res) => ({
      label: res.label,
      icon: 'i-lucide-monitor',
      type: 'checkbox' as const,
      checked:
        Math.abs((options.projectStore.activeMonitor?.previewResolution ?? 1) - res.value) < 0.001,
      onSelect: () => {
        if (options.projectStore.activeMonitor) {
          options.projectStore.activeMonitor.previewResolution = res.value;
        }
      },
    })),
  ]);

  return {
    canInteractPlayback,
    centerMonitor,
    contextMenuItems,
    createMarkerAtPlayhead,
    handleBoundaryWheel,
    handleEndBoundaryWheel,
    handleSpeedWheel,
    negativeSpeedOptions,
    onPlaybackSpeedChange,
    playbackSpeedOptions,
    previewResolutions,
    resetZoom,
    rewindToEnd,
    rewindToStart,
    selectedPlaybackSpeedOption,
    setPlayback,
    speedButtonLabel,
    togglePlayback,
    togglePreviewEffects,
    toggleProxyUsage,
    toolbarPosition,
  };
}
