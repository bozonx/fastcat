import { useResizeObserver } from '@vueuse/core';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { getPreviewWorkerClient, setPreviewHostApi } from '~/utils/video-editor/worker-client';

import { AudioEngine } from '~/utils/video-editor/AudioEngine';
import { clampTimeUs } from '~/utils/monitor-time';

import type { WorkerTimelineClip } from './types';
import type { UseMonitorCoreOptions } from './useMonitorCore.types';
import { cloneWorkerPayload, createPreviewRenderOptions } from './useMonitorCore.helpers';
import { mapAudioEngineClips } from './useMonitorCore.audio';
import { createMonitorCompositorRuntime } from './useMonitorCore.compositor';
import { createMonitorPreviewHostApi } from './useMonitorCore.hostApi';
import {
  computeMonitorTimelineDuration,
  prepareMonitorTimelineState,
} from './useMonitorCore.timeline';
import {
  getMonitorLayoutUpdatePayload,
  hasProxyForMonitorSources,
  shouldScheduleAudioLayoutUpdate,
  shouldScheduleClipLayoutUpdate,
} from './useMonitorCore.watchers';

export function useMonitorCore(options: UseMonitorCoreOptions) {
  const { t } = useI18n();
  const uiStore = useUiStore();
  const workspaceStore = useWorkspaceStore();
  const currentProjectStore = useProjectStore();
  const { projectStore, timelineStore, proxyStore, monitorTimeline, monitorDisplay } = options;

  const {
    rawWorkerTimelineClips,
    rawWorkerAudioClips,
    workerTimelineClips,
    workerAudioClips,
    safeDurationUs,
    clipSourceSignature,
    clipLayoutSignature,
    audioClipSourceSignature,
    audioClipLayoutSignature,
  } = monitorTimeline;

  const { containerEl, viewportEl, renderWidth, renderHeight, updateCanvasDisplaySize } =
    monitorDisplay;

  const isLoading = ref(false);
  const loadError = ref<string | null>(null);

  const BUILD_DEBOUNCE_MS = 120;
  const LAYOUT_DEBOUNCE_MS = 50;

  let buildRequestId = 0;
  let lastBuiltSourceSignature = 0;
  let lastBuiltLayoutSignature = 0;
  let buildInFlight = false;
  let buildRequested = false;
  let buildDebounceTimer: number | null = null;
  let layoutDebounceTimer: number | null = null;
  let layoutUpdateInFlight = false;
  let pendingLayoutClips: WorkerTimelineClip[] | null = null;
  let pendingLayoutAudioClips: WorkerTimelineClip[] | null = null;
  let isUnmounted = false;
  let forceRecreateCompositorNextBuild = false;
  let currentTimeProvider: (() => number) | null = null;
  let layoutUpdateFromQueue = false;
  const audioHandleCache = new Map<string, FileSystemFileHandle>();
  let resizeScheduled = false;

  const audioEngine = new AudioEngine();
  const { client } = getPreviewWorkerClient();
  const compositorRuntime = createMonitorCompositorRuntime({
    client,
    containerEl,
    renderWidth,
    renderHeight,
    isUnmounted: () => isUnmounted,
    getPreviewRenderOptions,
  });

  useResizeObserver(viewportEl, () => {
    if (isUnmounted || resizeScheduled) {
      return;
    }

    resizeScheduled = true;
    requestAnimationFrame(() => {
      resizeScheduled = false;
      updateCanvasDisplaySize();
    });
  });

  const useProxyInMonitor = computed(() => {
    return projectStore.projectSettings.monitor?.useProxy !== false;
  });

  const previewEffectsEnabled = computed(() => {
    return projectStore.projectSettings.monitor?.previewEffectsEnabled !== false;
  });

  function getPreviewRenderOptions() {
    return createPreviewRenderOptions({
      previewEffectsEnabled: previewEffectsEnabled.value,
      videoFrameCacheMb: workspaceStore.userSettings.optimization.videoFrameCacheMb,
    });
  }

  function setCurrentTimeProvider(provider: () => number) {
    currentTimeProvider = provider;
  }

  async function syncAudioEngineClips(audioClips: WorkerTimelineClip[]) {
    const audioEngineClips = await mapAudioEngineClips({
      clips: audioClips,
      useProxyInMonitor: useProxyInMonitor.value,
      audioHandleCache,
      getProxyFileHandle: proxyStore.getProxyFileHandle,
      getFileHandleByPath: projectStore.getFileHandleByPath,
    });

    return audioEngineClips;
  }

  async function flushBuildQueue() {
    if (buildInFlight) return;

    buildInFlight = true;
    try {
      while (buildRequested && !isUnmounted) {
        buildRequested = false;
        await buildTimeline();
      }
    } finally {
      buildInFlight = false;
    }
  }

  function scheduleLayoutUpdate(
    layoutClips: WorkerTimelineClip[],
    audioClips: WorkerTimelineClip[],
  ) {
    pendingLayoutClips = layoutClips;
    pendingLayoutAudioClips = audioClips;
    if (layoutDebounceTimer !== null) {
      clearTimeout(layoutDebounceTimer);
    }
    layoutDebounceTimer = window.setTimeout(() => {
      layoutDebounceTimer = null;
      void flushLayoutUpdateQueue();
    }, LAYOUT_DEBOUNCE_MS);
  }

  function getRenderTimeForLayoutUpdate() {
    if (currentTimeProvider) return currentTimeProvider();
    return clampToTimeline(timelineStore.currentTime);
  }

  async function flushLayoutUpdateQueue() {
    if (layoutUpdateInFlight || isUnmounted) return;

    layoutUpdateInFlight = true;
    try {
      while (pendingLayoutClips && pendingLayoutAudioClips) {
        const layoutClips = pendingLayoutClips;
        const layoutAudioClips = pendingLayoutAudioClips;
        pendingLayoutClips = null;
        pendingLayoutAudioClips = null;
        try {
          const preparedTimeline = await prepareMonitorTimelineState({
            rawAudioClips: layoutAudioClips,
            tracks: timelineStore.timelineDoc?.tracks ?? [],
            projectStore,
            workspaceStore,
            masterEffects: timelineStore.timelineDoc?.metadata?.fastcat?.masterEffects,
          });
          const flattenedClips = preparedTimeline.flattenedClips;
          const flattenedAudio = preparedTimeline.flattenedAudio;

          workerTimelineClips.value = flattenedClips;
          workerAudioClips.value = flattenedAudio;

          layoutUpdateFromQueue = true;

          const payload = cloneWorkerPayload(preparedTimeline.payload);
          const maxDuration = await client.updateTimelineLayout(payload);
          // Keep store duration at least as large as current value to avoid clamping
          // when disabled clips are excluded from the worker payload.
          timelineStore.duration = computeMonitorTimelineDuration({
            currentDurationUs: timelineStore.duration,
            maxDurationUs: maxDuration,
            audioDurationUs: preparedTimeline.audioDurationUs,
          });
          lastBuiltLayoutSignature = clipLayoutSignature.value;
          layoutUpdateFromQueue = false;
          scheduleRender(getRenderTimeForLayoutUpdate());
        } catch (error) {
          console.error('[Monitor] Failed to update timeline layout', error);
          timelineStore.isPlaying = false;
          scheduleBuild();
        }
      }

      const audioClips = workerAudioClips.value;
      const audioEngineClips = await syncAudioEngineClips(audioClips);

      audioEngine.updateTimelineLayout(audioEngineClips);
    } finally {
      layoutUpdateInFlight = false;
    }
  }

  function scheduleBuild() {
    if (buildDebounceTimer !== null) {
      clearTimeout(buildDebounceTimer);
    }
    buildDebounceTimer = window.setTimeout(() => {
      buildDebounceTimer = null;
      buildRequested = true;
      void flushBuildQueue();
    }, BUILD_DEBOUNCE_MS);
  }

  const scheduleRender = compositorRuntime.scheduleRender;

  function updateStoreTime(timeUs: number) {
    const normalizedTimeUs = clampToTimeline(timeUs);
    if (timelineStore.currentTime === normalizedTimeUs) {
      return;
    }
    timelineStore.setCurrentTimeUs(normalizedTimeUs);
  }

  function clampToTimeline(timeUs: number): number {
    return clampTimeUs(timeUs, safeDurationUs.value);
  }

  async function ensureCompositorReady(options?: { forceRecreate?: boolean }) {
    await compositorRuntime.ensureReady(options);
  }

  async function buildTimeline() {
    if (!containerEl.value) return;
    const requestId = ++buildRequestId;
    isLoading.value = true;
    loadError.value = null;

    try {
      await ensureCompositorReady({ forceRecreate: forceRecreateCompositorNextBuild });
      forceRecreateCompositorNextBuild = false;

      // Invalidate audio handle cache on full rebuild
      audioHandleCache.clear();

      const rawAudio = rawWorkerAudioClips?.value ?? workerAudioClips.value;

      const preparedTimeline = await prepareMonitorTimelineState({
        rawAudioClips: rawAudio,
        tracks: timelineStore.timelineDoc?.tracks ?? [],
        projectStore,
        workspaceStore,
        masterEffects: timelineStore.timelineDoc?.metadata?.fastcat?.masterEffects,
      });
      const flattenedClips = preparedTimeline.flattenedClips;
      const flattenedAudio = preparedTimeline.flattenedAudio;

      workerTimelineClips.value = flattenedClips;
      workerAudioClips.value = flattenedAudio;

      const clips = flattenedClips;
      const audioClips = flattenedAudio;

      if (clips.length === 0 && audioClips.length === 0) {
        await client.clearClips();
        await audioEngine.loadClips([]);
        timelineStore.duration = 0;
        updateStoreTime(0);
        isLoading.value = false;
        return;
      }

      setPreviewHostApi(
        createMonitorPreviewHostApi({
          currentProjectId: currentProjectStore.currentProjectId,
          workspaceHandle: workspaceStore.workspaceHandle,
          resolvedStorageTopology: workspaceStore.resolvedStorageTopology,
          useProxyInMonitor: useProxyInMonitor.value,
          getProxyFileHandle: proxyStore.getProxyFileHandle,
          getProxyFile: proxyStore.getProxyFile,
          getFileHandleByPath: projectStore.getFileHandleByPath,
          getFileByPath: projectStore.getFileByPath,
        }),
      );

      const payload = cloneWorkerPayload(preparedTimeline.payload);
      const maxDuration = clips.length > 0 ? await client.loadTimeline(payload) : 0;
      if (clips.length === 0) {
        await client.clearClips();
      }

      await audioEngine.init({
        sampleRate: projectStore.projectSettings?.project?.sampleRate,
      });

      const audioEngineClips = await syncAudioEngineClips(audioClips);
      await audioEngine.loadClips(audioEngineClips);

      lastBuiltSourceSignature = clipSourceSignature.value;
      lastBuiltLayoutSignature = clipLayoutSignature.value;

      // Keep store duration at least as large as current value to avoid clamping
      // when disabled clips are excluded from the worker payload.
      timelineStore.duration = computeMonitorTimelineDuration({
        currentDurationUs: timelineStore.duration,
        maxDurationUs: maxDuration,
        audioDurationUs: preparedTimeline.audioDurationUs,
        normalize: true,
      });

      // Render at current time without clamping — the dispatchers already
      // keep duration including disabled clips.
      scheduleRender(getRenderTimeForLayoutUpdate());
    } catch (e: any) {
      console.error('Failed to build timeline components', e);
      if (requestId === buildRequestId) {
        loadError.value = e.message || t('fastcat.monitor.loadError', 'Error loading timeline');
      }
    } finally {
      if (requestId === buildRequestId) {
        isLoading.value = false;
      }
    }
  }

  watch(clipSourceSignature, () => {
    scheduleBuild();
  });

  watch(
    () => proxyStore.existingProxies.value,
    (newVal) => {
      if (isUnmounted) return;
      if (!useProxyInMonitor.value) return;

      const hasNewProxyForClips = hasProxyForMonitorSources({
        clips: workerTimelineClips.value,
        audioClips: workerAudioClips.value,
        existingProxies: newVal,
      });

      if (hasNewProxyForClips) {
        scheduleBuild();
      }
    },
    { deep: true }, // We need deep to watch Set mutations
  );

  watch(audioClipSourceSignature, () => {
    scheduleBuild();
  });

  watch(
    () => useProxyInMonitor.value,
    () => {
      if (isUnmounted) return;

      timelineStore.isPlaying = false;
      audioHandleCache.clear();
      forceRecreateCompositorNextBuild = true;
      compositorRuntime.invalidate();
      scheduleBuild();
    },
  );

  watch(
    () => previewEffectsEnabled.value,
    () => {
      if (isUnmounted) return;
      scheduleRender(getRenderTimeForLayoutUpdate());
    },
  );

  watch(clipLayoutSignature, () => {
    if (
      !shouldScheduleClipLayoutUpdate({
        isLoading: isLoading.value,
        isCompositorReady: compositorRuntime.isReady(),
        clipSourceSignature: clipSourceSignature.value,
        lastBuiltSourceSignature,
        clipLayoutSignature: clipLayoutSignature.value,
        lastBuiltLayoutSignature,
        layoutUpdateFromQueue,
      })
    ) {
      return;
    }

    const { layoutClips, layoutAudioClips } = getMonitorLayoutUpdatePayload({
      rawWorkerTimelineClips,
      rawWorkerAudioClips,
      workerTimelineClips,
      workerAudioClips,
    });
    scheduleLayoutUpdate(layoutClips, layoutAudioClips);
  });

  watch(audioClipLayoutSignature, () => {
    if (
      !shouldScheduleAudioLayoutUpdate({
        isLoading: isLoading.value,
        isCompositorReady: compositorRuntime.isReady(),
      })
    ) {
      return;
    }

    const { layoutClips, layoutAudioClips } = getMonitorLayoutUpdatePayload({
      rawWorkerTimelineClips,
      rawWorkerAudioClips,
      workerTimelineClips,
      workerAudioClips,
    });
    scheduleLayoutUpdate(layoutClips, layoutAudioClips);
  });

  watch(
    () => [timelineStore.masterGain, timelineStore.audioMuted],
    () => {
      const effectiveMaster = timelineStore.audioMuted ? 0 : timelineStore.masterGain;
      audioEngine.setMasterVolume(effectiveMaster);
    },
    { immediate: true },
  );

  watch(
    () => [uiStore.monitorVolume, uiStore.monitorMuted],
    () => {
      const effectiveMonitor = uiStore.monitorMuted ? 0 : uiStore.monitorVolume;
      audioEngine.setMonitorVolume(effectiveMonitor);
    },
    { immediate: true },
  );

  watch(
    () => [
      projectStore.projectSettings?.project?.width ?? 0,
      projectStore.projectSettings?.project?.height ?? 0,
      projectStore.projectSettings?.monitor?.previewResolution ?? 0,
    ],
    () => {
      updateCanvasDisplaySize();
      compositorRuntime.invalidate();
      scheduleBuild();
    },
  );

  onMounted(() => {
    isUnmounted = false;
    updateCanvasDisplaySize();
    scheduleBuild();
  });

  onBeforeUnmount(() => {
    isUnmounted = true;
    timelineStore.isPlaying = false;
    compositorRuntime.clearPendingRender();
    if (buildDebounceTimer !== null) {
      clearTimeout(buildDebounceTimer);
      buildDebounceTimer = null;
    }
    if (layoutDebounceTimer !== null) {
      clearTimeout(layoutDebounceTimer);
      layoutDebounceTimer = null;
    }

    try {
      audioEngine.destroy();
    } catch (err) {
      console.error('[Monitor] Failed to destroy AudioEngine', err);
    }

    pendingLayoutClips = null;
    pendingLayoutAudioClips = null;
    void compositorRuntime.destroy().catch((error) => {
      console.error('[Monitor] Failed to destroy compositor on unmount', error);
    });
  });

  return {
    audioEngine,
    clampToTimeline,
    isLoading,
    loadError,
    previewEffectsEnabled,
    scheduleBuild,
    scheduleRender,
    setCurrentTimeProvider,
    updateStoreTime,
    useProxyInMonitor,
  };
}
