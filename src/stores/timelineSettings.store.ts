import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useLocalStorage } from '@vueuse/core';
import type { OverlapMode, FrameSnapMode, ClipSnapMode } from '~/utils/timeline-modes';
import { DEFAULT_SNAP_SETTINGS } from '~/utils/timeline-modes';
import { useWorkspaceStore } from '~/stores/workspace.store';

export const useTimelineSettingsStore = defineStore('timelineSettings', () => {
  const workspaceStore = useWorkspaceStore();

  const overlapMode = useLocalStorage<OverlapMode>(
    'gran-editor-overlap-mode',
    DEFAULT_SNAP_SETTINGS.overlapMode,
  );

  const frameSnapMode = useLocalStorage<FrameSnapMode>(
    'gran-editor-frame-snap-mode',
    DEFAULT_SNAP_SETTINGS.frameSnapMode,
  );

  const clipSnapMode = useLocalStorage<ClipSnapMode>(
    'gran-editor-clip-snap-mode',
    DEFAULT_SNAP_SETTINGS.clipSnapMode,
  );

  const snapThresholdPxLegacy = useLocalStorage<number>(
    'gran-editor-snap-threshold-px',
    DEFAULT_SNAP_SETTINGS.snapThresholdPx,
  );

  const snapThresholdPx = ref<number>(DEFAULT_SNAP_SETTINGS.snapThresholdPx);

  if (overlapMode.value !== 'none' && overlapMode.value !== 'pseudo') {
    overlapMode.value = DEFAULT_SNAP_SETTINGS.overlapMode;
  }

  if (frameSnapMode.value !== 'free' && frameSnapMode.value !== 'frames') {
    frameSnapMode.value = DEFAULT_SNAP_SETTINGS.frameSnapMode;
  }

  if (clipSnapMode.value !== 'none' && clipSnapMode.value !== 'clips') {
    clipSnapMode.value = DEFAULT_SNAP_SETTINGS.clipSnapMode;
  }

  const configuredSnapThresholdPx = Number(workspaceStore.userSettings.timeline?.snapThresholdPx);
  const legacySnapThresholdPx = Number(snapThresholdPxLegacy.value);
  const snapThresholdCandidate = Number.isFinite(configuredSnapThresholdPx)
    ? configuredSnapThresholdPx
    : legacySnapThresholdPx;
  snapThresholdPx.value =
    Number.isFinite(snapThresholdCandidate) && snapThresholdCandidate > 0
      ? Math.max(1, Math.round(snapThresholdCandidate))
      : DEFAULT_SNAP_SETTINGS.snapThresholdPx;

  function setOverlapMode(mode: OverlapMode) {
    overlapMode.value = mode;
  }

  function setFrameSnapMode(mode: FrameSnapMode) {
    frameSnapMode.value = mode;
  }

  function setClipSnapMode(mode: ClipSnapMode) {
    clipSnapMode.value = mode;
  }

  function setSnapThresholdPx(value: number) {
    const next = Math.max(1, Math.round(value));
    snapThresholdPx.value = next;
    workspaceStore.userSettings.timeline.snapThresholdPx = next;
  }

  return {
    overlapMode,
    frameSnapMode,
    clipSnapMode,
    snapThresholdPx,
    setOverlapMode,
    setFrameSnapMode,
    setClipSnapMode,
    setSnapThresholdPx,
  };
});
