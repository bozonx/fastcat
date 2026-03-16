import { computed, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProxyStore } from '~/stores/proxy.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useUiStore } from '~/stores/ui.store';
import { useMonitorTimeline } from '~/composables/monitor/useMonitorTimeline';
import { useMonitorDisplay } from '~/composables/monitor/useMonitorDisplay';
import { useMonitorPlayback } from '~/composables/monitor/useMonitorPlayback';
import { useMonitorCore } from '~/composables/monitor/useMonitorCore';
import { useMonitorSnapshot } from '~/composables/monitor/useMonitorSnapshot';

export interface MonitorViewportPublicApi {
  viewportEl?: HTMLElement | null;
  centerMonitor: () => void;
  resetZoom: () => void;
  resetView: () => void;
}

export function useMonitorRuntime() {
  const projectStore = useProjectStore();
  const timelineStore = useTimelineStore();
  const proxyStore = useProxyStore();
  const workspaceStore = useWorkspaceStore();
  const selectionStore = useSelectionStore();
  const uiStore = useUiStore();
  const { isPlaying, currentTime, duration } = storeToRefs(timelineStore);

  const {
    videoItems,
    workerTimelineClips,
    workerAudioClips,
    workerTimelinePayload,
    rawWorkerTimelineClips,
    rawWorkerAudioClips,
    safeDurationUs,
    clipSourceSignature,
    clipLayoutSignature,
    audioClipSourceSignature,
    audioClipLayoutSignature,
  } = useMonitorTimeline();

  const selectedTimelineClip = computed(() => {
    const entity = selectionStore.selectedEntity;
    if (entity?.source !== 'timeline' || entity.kind !== 'clip') {
      return null;
    }

    return rawWorkerTimelineClips.value.find((clip) => clip.id === entity.itemId) ?? null;
  });

  const isTextClipSelected = computed(() => selectedTimelineClip.value?.clipType === 'text');

  const { containerEl, renderWidth, renderHeight, updateCanvasDisplaySize } = useMonitorDisplay();

  const viewportRef = ref<MonitorViewportPublicApi | null>(null);
  const viewportEl = computed(
    () => (viewportRef.value?.viewportEl as HTMLDivElement | null) ?? null,
  );

  const {
    isLoading,
    loadError,
    previewEffectsEnabled,
    scheduleRender,
    scheduleBuild,
    clampToTimeline,
    updateStoreTime,
    audioEngine,
    useProxyInMonitor,
    setCurrentTimeProvider,
  } = useMonitorCore({
    projectStore,
    timelineStore,
    proxyStore: {
      getProxyFileHandle: proxyStore.getProxyFileHandle,
      getProxyFile: proxyStore.getProxyFile,
      existingProxies: computed(() => proxyStore.existingProxies),
    },
    monitorTimeline: {
      videoItems,
      workerTimelineClips,
      workerAudioClips,
      workerTimelinePayload,
      rawWorkerTimelineClips,
      rawWorkerAudioClips,
      safeDurationUs,
      clipSourceSignature,
      clipLayoutSignature,
      audioClipSourceSignature,
      audioClipLayoutSignature,
    },
    monitorDisplay: {
      containerEl,
      viewportEl,
      renderWidth,
      renderHeight,
      updateCanvasDisplaySize,
    },
  });

  const timecodeEl = ref<HTMLElement | null>(null);
  const { uiCurrentTimeUs, getLocalCurrentTimeUs, setTimecodeEl } = useMonitorPlayback({
    isLoading,
    loadError,
    isPlaying,
    currentTime,
    duration,
    safeDurationUs,
    getFps: () => projectStore.projectSettings?.project?.fps,
    clampToTimeline,
    updateStoreTime,
    scheduleRender,
    audioEngine,
  });

  setCurrentTimeProvider(getLocalCurrentTimeUs);

  onMounted(() => {
    setTimecodeEl(timecodeEl.value);
    timelineStore.setPlaybackGestureHandler((nextPlaying) => {
      if (nextPlaying) {
        audioEngine.resumeContext();
      }
    });
  });

  const { isSavingStopFrame, createStopFrameSnapshot, saveTimelineThumbnail } = useMonitorSnapshot({
    projectStore,
    timelineStore,
    workspaceStore,
    isLoading,
    loadError,
    uiCurrentTimeUs,
    workerTimelineClips,
    rawWorkerTimelineClips,
    workerTimelinePayload,
  });

  watch(
    () => uiStore.timelineSaveTrigger,
    () => {
      saveTimelineThumbnail();
    },
  );

  return {
    projectStore,
    timelineStore,
    workspaceStore,
    selectionStore,
    uiStore,
    videoItems,
    workerTimelineClips,
    workerAudioClips,
    rawWorkerTimelineClips,
    rawWorkerAudioClips,
    safeDurationUs,
    selectedTimelineClip,
    isTextClipSelected,
    containerEl,
    renderWidth,
    renderHeight,
    updateCanvasDisplaySize,
    viewportRef,
    viewportEl,
    isLoading,
    loadError,
    previewEffectsEnabled,
    scheduleRender,
    scheduleBuild,
    clampToTimeline,
    updateStoreTime,
    audioEngine,
    useProxyInMonitor,
    isSavingStopFrame,
    createStopFrameSnapshot,
    saveTimelineThumbnail,
    timecodeEl,
    uiCurrentTimeUs,
  };
}
