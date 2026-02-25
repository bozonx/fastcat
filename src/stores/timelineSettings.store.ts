import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useLocalStorage } from '@vueuse/core';
import type { OverlapMode, FrameSnapMode, ClipSnapMode } from '~/utils/timeline-modes';
import { DEFAULT_SNAP_SETTINGS } from '~/utils/timeline-modes';

export const useTimelineSettingsStore = defineStore('timelineSettings', () => {
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

  const snapThresholdPx = useLocalStorage<number>(
    'gran-editor-snap-threshold-px',
    DEFAULT_SNAP_SETTINGS.snapThresholdPx,
  );

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
    snapThresholdPx.value = Math.max(1, Math.round(value));
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
