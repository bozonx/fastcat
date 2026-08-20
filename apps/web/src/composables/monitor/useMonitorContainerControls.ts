import { computed, ref, type Ref } from 'vue';
import { nativeMonitorIpc } from '~/composables/monitor/native-monitor-ipc';
import { useMonitorSettings } from '~/composables/monitor/useMonitorSettings';
import type { useProjectStore } from '~/stores/project.store';
import type { useTimelineStore } from '~/stores/timeline.store';
import type { useSelectionStore } from '~/stores/selection.store';
import type { useWorkspaceStore } from '~/stores/workspace.store';
import type { MonitorSyncMode } from '~/composables/monitor/useMonitorPlayback';
import { isTauriRuntime } from '~/utils/runtime';
import { PLAYBACK_SPEED_VALUES, formatSpeedLabel } from '~/utils/playbackSpeeds';
import type { HotkeyCommandId } from '~/utils/hotkeys/defaultHotkeys';

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
type HotkeyTitleFn = (baseTitle: string, commandId: HotkeyCommandId) => string;

interface MonitorViewportPublicApi {
  centerMonitor: () => void;
  resetZoom: () => void;
  resetView: () => void;
  fitMonitor: () => void;
}

interface UseMonitorContainerControlsOptions {
  t: TranslateFn;
  getHotkeyTitle?: HotkeyTitleFn;
  projectStore: ReturnType<typeof useProjectStore>;
  workspaceStore: ReturnType<typeof useWorkspaceStore>;
  timelineStore: ReturnType<typeof useTimelineStore>;
  selectionStore: ReturnType<typeof useSelectionStore>;
  viewportRef: Ref<MonitorViewportPublicApi | null>;
  videoItems: Ref<unknown[]>;
  isLoading: Ref<boolean>;
  loadError: Ref<string | null>;
  safeDurationTicks: Ref<number>;
  previewEffectsEnabled: Ref<boolean>;
  useProxyInMonitor: Ref<boolean>;
  showGrid: Ref<boolean>;
  isSavingStopFrame: Ref<boolean>;
  createStopFrameSnapshot: () => Promise<void>;
  scheduleBuild: () => void;
  toggleGrid: () => void;
  isMobile?: boolean;
}

export function useMonitorContainerControls(options: UseMonitorContainerControlsOptions) {
  const { showTimecode, showTransparencyGrid, showMarkerTexts } = useMonitorSettings();
  const getHotkeyTitle = options.getHotkeyTitle ?? ((baseTitle: string) => baseTitle);

  const monitorSyncOptions: Array<{
    value: MonitorSyncMode;
    icon: string;
    labelKey: string;
    titleKey: string;
  }> = [
    {
      value: 'smooth',
      icon: 'i-lucide-waves',
      labelKey: 'fastcat.monitor.syncSmooth',
      titleKey: 'fastcat.monitor.syncSmoothTitle',
    },
    {
      value: 'balanced',
      icon: 'i-lucide-gauge',
      labelKey: 'fastcat.monitor.syncBalanced',
      titleKey: 'fastcat.monitor.syncBalancedTitle',
    },
    {
      value: 'strict',
      icon: 'i-lucide-crosshair',
      labelKey: 'fastcat.monitor.syncStrict',
      titleKey: 'fastcat.monitor.syncStrictTitle',
    },
  ];

  const currentMonitorSyncMode = computed<MonitorSyncMode>(
    () => options.workspaceStore.userSettings?.optimization?.nativeMonitorSyncMode ?? 'balanced',
  );

  const selectedMonitorSyncOption = computed(
    () =>
      monitorSyncOptions.find((option) => option.value === currentMonitorSyncMode.value) ??
      monitorSyncOptions[1]!,
  );

  const playbackSpeedOptions: PlaybackSpeedOption[] = PLAYBACK_SPEED_VALUES.map((v) => ({
    label: formatSpeedLabel(v),
    value: v,
  }));

  // Negative speeds in descending order (fastest to slowest: -5 … -0.5)
  const negativeSpeedOptions: PlaybackSpeedOption[] = [...PLAYBACK_SPEED_VALUES]
    .reverse()
    .map((v) => ({ label: formatSpeedLabel(-v), value: -v }));

  // Full list used for mouse-wheel traversal: most-negative → most-positive
  const wheelSpeedList: PlaybackSpeedOption[] = [...negativeSpeedOptions, ...playbackSpeedOptions];

  const canInteractPlayback = computed(
    () =>
      !options.isLoading.value &&
      (options.safeDurationTicks.value > 0 || options.videoItems.value.length > 0),
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
    const projectHeight = Math.max(1, Math.round(options.timelineStore.timelineFormat.height));

    // Standard fractional preview resolutions (Full, 1/2, 1/4, 1/8)
    const scales = [1, 0.5, 0.25, 0.125];

    // 0 = "Auto": the render scale is derived from the steady motion quality tier. The scale is
    // deliberately constant across play/pause (no "still frame ⇒ full res" bump — that was removed
    // because flipping preview_scale drops & re-decodes every native video runtime; see
    // resolvePreviewRenderScale). This is the default and sits first in the menu.
    const autoOption: PreviewResolutionOption = {
      label: options.t('fastcat.timeline.transition.blurQualityAuto'),
      shortLabel: options.t('fastcat.timeline.transition.blurQualityAuto'),
      value: 0,
      isProject: false,
    };

    return [
      autoOption,
      ...scales.map((scale) => {
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
      }),
    ];
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

  function toggleTransparencyGrid() {
    showTransparencyGrid.value = !showTransparencyGrid.value;
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
    options.timelineStore.setCurrentTimeTicks(0);
    options.timelineStore.requestScrollToPlayhead?.();
    blurActiveElement();
  }

  function rewindToEnd() {
    options.timelineStore.setCurrentTimeTicks(options.safeDurationTicks.value);
    options.timelineStore.requestScrollToPlayhead?.();
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

  const isAddMarkerModalOpen = ref(false);

  function createMarkerWithTextAtPlayhead(params: { text: string; color: string }) {
    const existingMarkers = options.timelineStore.markers;
    options.timelineStore.addMarker({
      timeTicks: options.timelineStore.currentTime,
      text: params.text,
      color: params.color,
    });
    const nextMarkers = options.timelineStore.markers;
    const createdMarker =
      nextMarkers.find((marker) => !existingMarkers.some((item) => item.id === marker.id)) ??
      nextMarkers[nextMarkers.length - 1];

    if (createdMarker) {
      options.selectionStore.selectTimelineMarker(createdMarker.id);
    }
  }

  function openNativeMonitorWindow() {
    void nativeMonitorIpc.openNativeWindow();
  }

  const contextMenuItems = computed(() => [
    [
      ...(options.isMobile
        ? []
        : [
            {
              label: options.t('fastcat.timeline.addMarkerWithText'),
              icon: 'i-heroicons-tag',
              onSelect: () => {
                isAddMarkerModalOpen.value = true;
              },
            },
          ]),
      {
        label: getHotkeyTitle(options.t('fastcat.monitor.snapshot'), 'general.snapshot'),
        icon: 'i-heroicons-camera',
        onSelect: options.createStopFrameSnapshot,
        disabled:
          options.isSavingStopFrame.value ||
          options.isLoading.value ||
          Boolean(options.loadError.value),
      },
      ...(isTauriRuntime()
        ? [
            {
              label: options.t('fastcat.monitor.openNativeMonitor'),
              icon: 'i-lucide-monitor-up',
              onSelect: openNativeMonitorWindow,
            },
          ]
        : []),
    ],
    [
      {
        label: getHotkeyTitle(options.t('fastcat.preview.fitToWindow'), 'general.zoomFit'),
        icon: 'i-heroicons-arrows-pointing-in',
        onSelect: fitMonitor,
      },
      {
        label: getHotkeyTitle(options.t('fastcat.monitor.center'), 'monitor.center'),
        icon: 'i-lucide-crosshair',
        onSelect: centerMonitor,
      },
      {
        label: getHotkeyTitle(options.t('fastcat.preview.resetZoom'), 'general.zoomReset'),
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
        label: options.t('fastcat.monitor.showTimecode'),
        icon: 'i-heroicons-clock',
        type: 'checkbox' as const,
        checked: showTimecode.value,
        onSelect: () => {
          showTimecode.value = !showTimecode.value;
        },
      },
      {
        label: options.t('fastcat.monitor.showMarkerTexts'),
        icon: 'i-heroicons-tag',
        type: 'checkbox' as const,
        checked: showMarkerTexts.value,
        onSelect: () => {
          showMarkerTexts.value = !showMarkerTexts.value;
        },
      },
      {
        label: options.t('fastcat.monitor.showTransparencyGrid'),
        icon: 'i-lucide-grid-3x3',
        type: 'checkbox' as const,
        checked: showTransparencyGrid.value,
        onSelect: toggleTransparencyGrid,
      },
      ...(options.isMobile
        ? [
            {
              label: options.t('fastcat.monitor.previewWithEffects'),
              icon: 'i-heroicons-sparkles',
              type: 'checkbox' as const,
              checked: options.previewEffectsEnabled.value,
              onSelect: togglePreviewEffects,
            },
            {
              label: options.t('fastcat.monitor.useProxy'),
              icon: 'i-heroicons-bolt',
              type: 'checkbox' as const,
              checked: options.useProxyInMonitor.value,
              onSelect: toggleProxyUsage,
            },
          ]
        : []),
    ],
    [
      ...(options.isMobile
        ? []
        : [
            {
              label: `${options.t('fastcat.monitor.playbackSpeed')} (${speedButtonLabel.value})`,
              icon: 'i-heroicons-forward',
              children: [
                ...negativeSpeedOptions.map((opt) => ({
                  label: opt.label,
                  type: 'checkbox' as const,
                  checked: options.timelineStore.playbackSpeed === opt.value,
                  onSelect: () => options.timelineStore.setPlaybackSpeed(opt.value),
                })),
                { label: '', type: 'separator' as const },
                ...playbackSpeedOptions.map((opt) => ({
                  label: opt.label,
                  type: 'checkbox' as const,
                  checked: options.timelineStore.playbackSpeed === opt.value,
                  onSelect: () => options.timelineStore.setPlaybackSpeed(opt.value),
                })),
              ],
            },
            {
              label: `${options.t('fastcat.monitor.syncMode')} (${options.t(
                selectedMonitorSyncOption.value.labelKey,
              )})`,
              icon: selectedMonitorSyncOption.value.icon,
              children: monitorSyncOptions.map((option) => ({
                label: options.t(option.labelKey),
                icon: option.icon,
                title: options.t(option.titleKey),
                type: 'checkbox' as const,
                checked: option.value === currentMonitorSyncMode.value,
                onSelect: () => {
                  if (options.workspaceStore.userSettings?.optimization) {
                    options.workspaceStore.userSettings.optimization.nativeMonitorSyncMode =
                      option.value;
                  }
                },
              })),
            },
          ]),
      {
        label: `${options.t('fastcat.monitor.previewBlurQuality')} (${options.t(
          (options.projectStore.activeMonitor?.previewBlurQuality ?? 'auto') === 'auto'
            ? 'fastcat.timeline.transition.blurQualityAuto'
            : `fastcat.timeline.transition.blurQuality${
                (options.projectStore.activeMonitor?.previewBlurQuality ?? 'auto')
                  .charAt(0)
                  .toUpperCase() +
                (options.projectStore.activeMonitor?.previewBlurQuality ?? 'auto').slice(1)
              }`,
        )})`,
        icon: 'i-heroicons-sparkles',
        children: (['auto', 'low', 'medium', 'high'] as const).map((q) => {
          const labelKey =
            q === 'auto'
              ? 'fastcat.timeline.transition.blurQualityAuto'
              : `fastcat.timeline.transition.blurQuality${q.charAt(0).toUpperCase() + q.slice(1)}`;
          return {
            label: options.t(labelKey),
            type: 'checkbox' as const,
            checked: (options.projectStore.activeMonitor?.previewBlurQuality ?? 'auto') === q,
            onSelect: () => {
              if (options.projectStore.activeMonitor) {
                options.projectStore.activeMonitor.previewBlurQuality = q;
              }
            },
          };
        }),
      },
      {
        label: `${options.t('fastcat.monitor.previewResolution')} (${
          previewResolutions.value.find(
            (res) =>
              Math.abs((options.projectStore.activeMonitor?.previewResolution ?? 0) - res.value) <
              0.001,
          )?.label ?? 'Auto'
        })`,
        icon: 'i-lucide-monitor',
        children: previewResolutions.value.map((res) => ({
          label: res.label,
          type: 'checkbox' as const,
          checked:
            Math.abs((options.projectStore.activeMonitor?.previewResolution ?? 0) - res.value) <
            0.001,
          onSelect: () => {
            if (options.projectStore.activeMonitor) {
              options.projectStore.activeMonitor.previewResolution = res.value;
            }
          },
        })),
      },
      ...(options.isMobile
        ? []
        : [
            {
              label: `${options.t('fastcat.monitor.toolbarPosition')} (${
                toolbarPosition.value === 'top'
                  ? options.t('fastcat.monitor.toolbarTop')
                  : toolbarPosition.value === 'right'
                    ? options.t('fastcat.monitor.toolbarRight')
                    : toolbarPosition.value === 'bottom'
                      ? options.t('fastcat.monitor.toolbarBottom')
                      : options.t('fastcat.monitor.toolbarLeft')
              })`,
              icon:
                toolbarPosition.value === 'top'
                  ? 'i-lucide-panel-top'
                  : toolbarPosition.value === 'right'
                    ? 'i-lucide-panel-right'
                    : toolbarPosition.value === 'bottom'
                      ? 'i-lucide-panel-bottom'
                      : 'i-lucide-panel-left',
              children: [
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
            },
          ]),
    ],
  ]);

  return {
    canInteractPlayback,
    centerMonitor,
    contextMenuItems,
    createMarkerAtPlayhead,
    isAddMarkerModalOpen,
    createMarkerWithTextAtPlayhead,
    handleBoundaryWheel,
    handleEndBoundaryWheel,
    handleSpeedWheel,
    negativeSpeedOptions,
    onPlaybackSpeedChange,
    playbackSpeedOptions,
    previewResolutions,
    resetView,
    resetZoom,
    rewindToEnd,
    rewindToStart,
    selectedPlaybackSpeedOption,
    setPlayback,
    showTransparencyGrid,
    speedButtonLabel,
    togglePlayback,
    togglePreviewEffects,
    toggleProxyUsage,
    toggleTransparencyGrid,
    toolbarPosition,
  };
}
