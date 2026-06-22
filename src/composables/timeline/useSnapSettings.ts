import { computed } from 'vue';
import type { ComputedRef, WritableComputedRef } from 'vue';
import type { ToolbarSnapMode } from '~/stores/timeline-settings.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useTimelineSettingsStore } from '~/stores/timeline-settings.store';

export interface SnapOption {
  value: ToolbarSnapMode;
  icon: string;
  label: string;
}

export interface UseSnapSettingsReturn {
  snapModeOptions: ComputedRef<SnapOption[]>;
  currentSnapOption: ComputedRef<SnapOption>;
  isSnapEnabled: ComputedRef<boolean>;
  snapThresholdPx: WritableComputedRef<number>;
  snapToTimelineEdges: WritableComputedRef<boolean>;
  snapToClips: WritableComputedRef<boolean>;
  snapToMarkers: WritableComputedRef<boolean>;
  snapToSelection: WritableComputedRef<boolean>;
  snapToPlayhead: WritableComputedRef<boolean>;
  snapPlayheadOnClick: WritableComputedRef<boolean>;
}

export function useSnapSettings(): UseSnapSettingsReturn {
  const { t } = useI18n();
  const workspaceStore = useWorkspaceStore();
  const settingsStore = useTimelineSettingsStore();

  const snapModeOptions = computed<SnapOption[]>(() => [
    {
      value: 'snap',
      icon: 'i-heroicons-link',
      label: t('fastcat.timeline.snapMode'),
    },
    {
      value: 'no_snap',
      icon: 'i-heroicons-link-slash',
      label: t('fastcat.timeline.snapModeFramesDescription'),
    },
  ]);

  const currentSnapOption = computed(
    () => snapModeOptions.value.find((o) => o.value === settingsStore.toolbarSnapMode) ?? snapModeOptions.value[0]!,
  );

  const isSnapEnabled = computed(() => settingsStore.toolbarSnapMode !== 'no_snap');

  const snapThresholdPx = computed({
    get: () => workspaceStore.userSettings.timeline.snapThresholdPx,
    set: (val: number) => settingsStore.setGlobalSnapThresholdPx(val),
  });

  const snapToTimelineEdges = computed({
    get: () => workspaceStore.userSettings.timeline.snapping.timelineEdges,
    set: (val: boolean) => (workspaceStore.userSettings.timeline.snapping.timelineEdges = val),
  });

  const snapToClips = computed({
    get: () => workspaceStore.userSettings.timeline.snapping.clips,
    set: (val: boolean) => (workspaceStore.userSettings.timeline.snapping.clips = val),
  });

  const snapToMarkers = computed({
    get: () => workspaceStore.userSettings.timeline.snapping.markers,
    set: (val: boolean) => (workspaceStore.userSettings.timeline.snapping.markers = val),
  });

  const snapToSelection = computed({
    get: () => workspaceStore.userSettings.timeline.snapping.selection,
    set: (val: boolean) => (workspaceStore.userSettings.timeline.snapping.selection = val),
  });

  const snapToPlayhead = computed({
    get: () => workspaceStore.userSettings.timeline.snapping.playhead,
    set: (val: boolean) => (workspaceStore.userSettings.timeline.snapping.playhead = val),
  });

  const snapPlayheadOnClick = computed({
    get: () => workspaceStore.userSettings.timeline.snapping.playheadClick,
    set: (val: boolean) => (workspaceStore.userSettings.timeline.snapping.playheadClick = val),
  });

  return {
    snapModeOptions,
    currentSnapOption,
    isSnapEnabled,
    snapThresholdPx,
    snapToTimelineEdges,
    snapToClips,
    snapToMarkers,
    snapToSelection,
    snapToPlayhead,
    snapPlayheadOnClick,
  };
}
