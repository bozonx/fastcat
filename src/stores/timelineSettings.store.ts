import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useLocalStorage } from '@vueuse/core';
import type { OverlapMode, FrameSnapMode, ClipSnapMode } from '~/utils/timeline-modes';
import { DEFAULT_SNAP_SETTINGS } from '~/utils/timeline-modes';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useTimelineStore } from '~/stores/timeline.store';

export type ToolbarMoveMode = 'snap' | 'free_mode' | 'pseudo_overlap' | 'copy';

export const useTimelineSettingsStore = defineStore('timelineSettings', () => {
  const workspaceStore = useWorkspaceStore();

  const timelineStore = useTimelineStore();

  const overlapMode = useLocalStorage<OverlapMode>(
    'fastcat:timeline:overlap-mode',
    DEFAULT_SNAP_SETTINGS.overlapMode,
  );

  const frameSnapMode = useLocalStorage<FrameSnapMode>(
    'fastcat:timeline:frame-snap-mode',
    DEFAULT_SNAP_SETTINGS.frameSnapMode,
  );

  const clipSnapMode = useLocalStorage<ClipSnapMode>(
    'fastcat:timeline:clip-snap-mode',
    DEFAULT_SNAP_SETTINGS.clipSnapMode,
  );

  const toolbarMoveMode = useLocalStorage<ToolbarMoveMode>(
    'fastcat:timeline:toolbar-move-mode',
    'snap',
  );

  if (overlapMode.value !== 'none' && overlapMode.value !== 'pseudo') {
    overlapMode.value = DEFAULT_SNAP_SETTINGS.overlapMode;
  }

  if (frameSnapMode.value !== 'free' && frameSnapMode.value !== 'frames') {
    frameSnapMode.value = DEFAULT_SNAP_SETTINGS.frameSnapMode;
  }

  if (clipSnapMode.value !== 'none' && clipSnapMode.value !== 'clips') {
    clipSnapMode.value = DEFAULT_SNAP_SETTINGS.clipSnapMode;
  }

  if (
    toolbarMoveMode.value !== 'snap' &&
    toolbarMoveMode.value !== 'free_mode' &&
    toolbarMoveMode.value !== 'pseudo_overlap' &&
    toolbarMoveMode.value !== 'copy'
  ) {
    toolbarMoveMode.value = 'snap';
  }

  const snapThresholdPx = computed(() => {
    const docThreshold = timelineStore.timelineDoc?.metadata?.fastcat?.snapThresholdPx;
    if (typeof docThreshold === 'number' && Number.isFinite(docThreshold) && docThreshold > 0) {
      return Math.round(docThreshold);
    }

    const globalThreshold = Number(workspaceStore.userSettings.timeline?.snapThresholdPx);
    if (Number.isFinite(globalThreshold) && globalThreshold > 0) {
      return Math.round(globalThreshold);
    }

    return DEFAULT_SNAP_SETTINGS.snapThresholdPx;
  });

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
    timelineStore.applyTimeline({
      type: 'update_timeline_properties',
      properties: {
        snapThresholdPx: next,
      },
    });
  }

  function setGlobalSnapThresholdPx(value: number) {
    const next = Math.max(1, Math.round(value));
    workspaceStore.userSettings.timeline.snapThresholdPx = next;
  }

  return {
    overlapMode,
    frameSnapMode,
    clipSnapMode,
    toolbarMoveMode,
    snapThresholdPx,
    setOverlapMode,
    setFrameSnapMode,
    setClipSnapMode,
    setSnapThresholdPx,
    setGlobalSnapThresholdPx,
  };
});
