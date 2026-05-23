import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { FrameSnapMode } from '~/utils/timeline-modes';
import { DEFAULT_SNAP_SETTINGS } from '~/utils/timeline-modes';
import { useWorkspaceStore } from '~/stores/workspace.store';

export type ToolbarSnapMode = 'snap' | 'no_snap' | 'free_mode';
export type ToolbarDragMode = 'pseudo_overlap' | 'copy' | 'slip';

export const useTimelineSettingsStore = defineStore('timelineSettings', () => {
  const workspaceStore = useWorkspaceStore();

  const frameSnapMode = computed({
    get: () => workspaceStore.userSettings.timeline.frameSnapMode,
    set: (v) => {
      workspaceStore.userSettings.timeline.frameSnapMode = v;
    },
  });

  const toolbarSnapMode = computed({
    get: () => workspaceStore.userSettings.timeline.toolbarSnapMode,
    set: (v) => {
      workspaceStore.userSettings.timeline.toolbarSnapMode = v;
    },
  });
  const toolbarDragMode = computed({
    get: () => workspaceStore.userSettings.timeline.toolbarDragMode,
    set: (v) => {
      workspaceStore.userSettings.timeline.toolbarDragMode = v;
    },
  });
  const toolbarDragModeEnabled = computed({
    get: () => workspaceStore.userSettings.timeline.toolbarDragModeEnabled,
    set: (v) => {
      workspaceStore.userSettings.timeline.toolbarDragModeEnabled = v;
    },
  });

  const landscapeDrawerPosition = ref<'right' | 'bottom'>('bottom');

  /** Pseudo-overlap is driven by the toolbar drag mode (cuts underlying clips). */
  const isPseudoOverlapEnabled = computed(
    () => toolbarDragModeEnabled.value && toolbarDragMode.value === 'pseudo_overlap',
  );

  if (frameSnapMode.value !== 'free' && frameSnapMode.value !== 'frames') {
    frameSnapMode.value = DEFAULT_SNAP_SETTINGS.frameSnapMode;
  }

  if (
    toolbarSnapMode.value !== 'snap' &&
    toolbarSnapMode.value !== 'no_snap' &&
    toolbarSnapMode.value !== 'free_mode'
  ) {
    toolbarSnapMode.value = 'snap';
  }

  if (
    toolbarDragMode.value !== 'pseudo_overlap' &&
    toolbarDragMode.value !== 'copy' &&
    toolbarDragMode.value !== 'slip'
  ) {
    toolbarDragMode.value = 'pseudo_overlap';
  }

  if (typeof toolbarDragModeEnabled.value !== 'boolean') {
    toolbarDragModeEnabled.value = false;
  }

  const snapThresholdPx = computed(() => {
    const globalThreshold = Number(workspaceStore.userSettings.timeline?.snapThresholdPx);
    if (Number.isFinite(globalThreshold) && globalThreshold > 0) {
      return Math.round(globalThreshold);
    }

    return DEFAULT_SNAP_SETTINGS.snapThresholdPx;
  });

  function setFrameSnapMode(mode: FrameSnapMode) {
    frameSnapMode.value = mode;
  }

  function setGlobalSnapThresholdPx(value: number) {
    const next = Math.max(1, Math.round(value));
    workspaceStore.userSettings.timeline.snapThresholdPx = next;
  }

  function selectToolbarSnapMode(mode: ToolbarSnapMode) {
    toolbarSnapMode.value = mode;
  }

  function cycleToolbarSnapMode() {
    if (toolbarSnapMode.value === 'snap') {
      toolbarSnapMode.value = 'no_snap';
      return;
    }

    if (toolbarSnapMode.value === 'no_snap') {
      toolbarSnapMode.value = 'free_mode';
      return;
    }

    toolbarSnapMode.value = 'snap';
  }

  function toggleToolbarSnapMode() {
    if (toolbarSnapMode.value === 'snap') {
      toolbarSnapMode.value = 'no_snap';
    } else if (toolbarSnapMode.value === 'free_mode') {
      toolbarSnapMode.value = 'no_snap';
    } else {
      toolbarSnapMode.value = 'snap';
    }
  }

  function toggleToolbarSnapModeFree() {
    if (toolbarSnapMode.value === 'snap') {
      toolbarSnapMode.value = 'free_mode';
    } else if (toolbarSnapMode.value === 'no_snap') {
      toolbarSnapMode.value = 'free_mode';
    } else {
      toolbarSnapMode.value = 'snap';
    }
  }

  function selectToolbarDragMode(mode: ToolbarDragMode) {
    toolbarDragMode.value = mode;
    toolbarDragModeEnabled.value = true;
  }

  function toggleSelectedToolbarDragMode() {
    toolbarDragModeEnabled.value = !toolbarDragModeEnabled.value;
  }

  function toggleToolbarPseudoOverlapMode() {
    if (toolbarDragMode.value !== 'pseudo_overlap') {
      toolbarDragMode.value = 'pseudo_overlap';
      toolbarDragModeEnabled.value = true;
      return;
    }

    toolbarDragModeEnabled.value = !toolbarDragModeEnabled.value;
  }

  const isSnapSettingsModalOpen = ref(false);

  return {
    frameSnapMode,
    toolbarSnapMode,
    toolbarDragMode,
    toolbarDragModeEnabled,
    isPseudoOverlapEnabled,
    snapThresholdPx,
    setFrameSnapMode,
    setGlobalSnapThresholdPx,
    selectToolbarSnapMode,
    cycleToolbarSnapMode,
    toggleToolbarSnapMode,
    toggleToolbarSnapModeFree,
    selectToolbarDragMode,
    toggleSelectedToolbarDragMode,
    landscapeDrawerPosition,
    toggleToolbarPseudoOverlapMode,
    isSnapSettingsModalOpen,
  };
});
