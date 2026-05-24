import { useResizeObserver } from '@vueuse/core';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import {
  broadcastPixiRendererPreference,
  getPreviewWorkerClient,
  setPreviewHostApi,
} from '~/utils/video-editor/worker-client';

import { AudioEngine } from '~/utils/video-editor/AudioEngine';
import { clampTimeUs } from '~/utils/monitor-time';

import type { WorkerTimelineClip } from './types';
import type { UseMonitorCoreOptions } from './useMonitorCore.types';
import { cloneWorkerPayload, createPreviewRenderOptions } from './useMonitorCore.helpers';
import { mapAudioEngineClips } from './useMonitorCore.audio';
import { createMonitorCompositorRuntime } from './useMonitorCore.compositor';
import { createMonitorPreviewHostApi } from './useMonitorCore.hostApi';
import {
  disposeMonitorCoreRuntime,
  initializeMonitorCoreRuntime,
} from './useMonitorCore.lifecycle';
import { createMonitorCoreQueues, type MonitorLayoutQueuePayload } from './useMonitorCore.queues';
import {
  computeMonitorTimelineDuration,
  prepareMonitorTimelineState,
} from './useMonitorCore.timeline';
import { registerMonitorCoreWatchers } from './useMonitorCore.wiring';

export function useMonitorCore(options: UseMonitorCoreOptions) {
  const { t } = useI18n();
  const toast = useToast();
  const uiStore = useUiStore();
  const workspaceStore = useWorkspaceStore();
  const currentProjectStore = useProjectStore();
  const { projectStore, timelineStore, proxyStore, monitorTimeline, monitorDisplay } = options;

  const {
    rawWorkerTimelineClips,
    rawWorkerAudioClips,
    workerTimelineClips,
    workerAudioClips,
    workerTimelinePayload,
    safeDurationUs,
    clipSourceSignature,
    clipLayoutSignature,
    clipContentSignature,
    activeLayoutSignature,
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
  let lastBuiltContentSignature = 0;
  let lastActiveLayoutSignature = 0;
  let isUnmounted = false;
  let forceRecreateCompositorNextBuild = false;
  let currentTimeProvider: (() => number) | null = null;
  let layoutUpdateFromQueue = false;
  const audioHandleCache = new Map<string, FileSystemFileHandle>();
  let resizeScheduled = false;
  let workerTimelineOperation: Promise<void> = Promise.resolve();

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
    return projectStore.activeMonitor?.useProxy !== false;
  });

  const previewEffectsEnabled = computed(() => {
    return projectStore.activeMonitor?.previewEffectsEnabled !== false;
  });

  const pixiRenderer = computed(() => {
    return workspaceStore.userSettings.optimization.pixiRenderer;
  });

  function getPreviewRenderOptions() {
    return createPreviewRenderOptions({
      previewEffectsEnabled: previewEffectsEnabled.value,
      pixiRenderer: workspaceStore.userSettings.optimization.pixiRenderer,
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

  function getRenderTimeForLayoutUpdate() {
    if (currentTimeProvider) return currentTimeProvider();
    return clampToTimeline(timelineStore.currentTime);
  }

  async function flushLayoutUpdate(params: MonitorLayoutQueuePayload) {
    try {
      const preparedTimeline = await prepareMonitorTimelineState({
        rawAudioClips: params.layoutAudioClips,
        tracks: timelineStore.timelineDoc?.tracks ?? [],
        projectStore,
        workspaceStore,
        masterEffects: timelineStore.timelineDoc?.metadata?.fastcat?.masterEffects,
        fallbackFormat: timelineStore.timelineFormat ?? undefined,
      });
      const flattenedClips = preparedTimeline.flattenedClips;
      const flattenedAudio = preparedTimeline.flattenedAudio;

      workerTimelineClips.value = flattenedClips;
      workerAudioClips.value = flattenedAudio;
      workerTimelinePayload.value = preparedTimeline.payload;

      layoutUpdateFromQueue = true;

      const payload = cloneWorkerPayload(preparedTimeline.payload);
      const maxDuration = await runWorkerTimelineOperation(async () => {
        await ensureCompositorReady();
        return await client.updateTimelineLayout(payload);
      });
      timelineStore.duration = Math.max(
        timelineStore.duration,
        computeMonitorTimelineDuration({
          currentDurationUs: timelineStore.duration,
          maxDurationUs: maxDuration,
          audioDurationUs: preparedTimeline.audioDurationUs,
        }),
      );
      lastBuiltLayoutSignature = clipLayoutSignature.value;
      lastBuiltContentSignature = clipContentSignature.value;

      const currentActiveLayoutSignature = activeLayoutSignature.value;
      const shouldScheduleRender = currentActiveLayoutSignature !== lastActiveLayoutSignature;
      lastActiveLayoutSignature = currentActiveLayoutSignature;

      if (shouldScheduleRender) {
        scheduleRender(getRenderTimeForLayoutUpdate());
      }
    } catch (error) {
      console.error('[Monitor] Failed to update timeline layout', error);
      toast.add({
        color: 'error',
        title: t('fastcat.monitor.playbackStopped'),
        description: t('fastcat.monitor.layoutError'),
      });
      timelineStore.isPlaying = false;
      scheduleBuild();
    } finally {
      layoutUpdateFromQueue = false;
    }

    const audioClips = workerAudioClips.value;
    const audioEngineClips = await syncAudioEngineClips(audioClips);

    audioEngine.updateTimelineLayout(audioEngineClips);
  }

  const queues = createMonitorCoreQueues({
    buildDebounceMs: BUILD_DEBOUNCE_MS,
    layoutDebounceMs: LAYOUT_DEBOUNCE_MS,
    isUnmounted: () => isUnmounted,
    flushBuild: buildTimeline,
    flushLayoutUpdate,
  });

  const scheduleBuild = queues.scheduleBuild;
  const scheduleLayoutUpdate = (
    layoutClips: WorkerTimelineClip[],
    audioClips: WorkerTimelineClip[],
    debounceMs?: number,
  ) => {
    queues.scheduleLayoutUpdate(
      {
        layoutClips,
        layoutAudioClips: audioClips,
      },
      debounceMs,
    );
  };

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

  async function runWorkerTimelineOperation<T>(operation: () => Promise<T>): Promise<T> {
    const nextOperation = workerTimelineOperation.catch(() => undefined).then(operation);
    workerTimelineOperation = nextOperation.then(
      () => undefined,
      () => undefined,
    );
    return nextOperation;
  }

  async function buildTimeline() {
    if (!containerEl.value) return;
    const requestId = ++buildRequestId;

    // Лоадер полностью убран по запросу, чтобы не блокировать превью

    loadError.value = null;

    try {
      // Invalidate audio handle cache on full rebuild
      audioHandleCache.clear();

      const rawAudio = rawWorkerAudioClips?.value ?? workerAudioClips.value;

      const preparedTimeline = await prepareMonitorTimelineState({
        rawAudioClips: rawAudio,
        tracks: timelineStore.timelineDoc?.tracks ?? [],
        projectStore,
        workspaceStore,
        masterEffects: timelineStore.timelineDoc?.metadata?.fastcat?.masterEffects,
        fallbackFormat: timelineStore.timelineFormat ?? undefined,
      });
      const flattenedClips = preparedTimeline.flattenedClips;
      const flattenedAudio = preparedTimeline.flattenedAudio;

      workerTimelineClips.value = flattenedClips;
      workerAudioClips.value = flattenedAudio;
      workerTimelinePayload.value = preparedTimeline.payload;

      const clips = flattenedClips;
      const audioClips = flattenedAudio;

      lastBuiltSourceSignature = clipSourceSignature.value;
      lastBuiltLayoutSignature = clipLayoutSignature.value;
      lastBuiltContentSignature = clipContentSignature.value;
      lastActiveLayoutSignature = activeLayoutSignature.value;

      if (clips.length === 0 && audioClips.length === 0) {
        // Re-check if the timeline loaded during our async operations.
        // If it has content now, a follow-up build is already scheduled by
        // the clipSourceSignature watcher — skip all state mutations here
        // to avoid clearing the compositor and resetting the playhead with
        // stale (pre-load) data.
        const hasTimelineContent = (timelineStore.timelineDoc?.tracks?.length ?? 0) > 0;
        if (hasTimelineContent) {
          isLoading.value = false;
          return;
        }

        await runWorkerTimelineOperation(async () => {
          await ensureCompositorReady({ forceRecreate: forceRecreateCompositorNextBuild });
          forceRecreateCompositorNextBuild = false;
          await client.clearClips();
        });
        await audioEngine.loadClips([]);
        if (requestId !== buildRequestId) {
          return;
        }
        if (timelineStore.timelineDoc !== null) {
          timelineStore.duration = 0;
          updateStoreTime(0);
        }
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
      const maxDuration = await runWorkerTimelineOperation(async () => {
        await ensureCompositorReady({ forceRecreate: forceRecreateCompositorNextBuild });
        forceRecreateCompositorNextBuild = false;
        return clips.length > 0 ? await client.loadTimeline(payload, requestId) : 0;
      });
      if (requestId !== buildRequestId) {
        return;
      }
      if (clips.length === 0) {
        await runWorkerTimelineOperation(async () => {
          await client.clearClips();
        });
      }

      await audioEngine.init({
        sampleRate:
          timelineStore.timelineFormat?.sampleRate ??
          projectStore.projectSettings?.project?.sampleRate,
      });

      const audioEngineClips = await syncAudioEngineClips(audioClips);
      await audioEngine.loadClips(audioEngineClips);

      // Keep store duration at least as large as current value to avoid clamping
      // when disabled clips are excluded from the worker payload.
      timelineStore.duration = Math.max(
        timelineStore.duration,
        computeMonitorTimelineDuration({
          currentDurationUs: timelineStore.duration,
          maxDurationUs: maxDuration,
          audioDurationUs: preparedTimeline.audioDurationUs,
          normalize: true,
        }),
      );

      // Render at current time without clamping — the dispatchers already
      // keep duration including disabled clips.
      scheduleRender(getRenderTimeForLayoutUpdate());
    } catch (e: unknown) {
      const err = e instanceof Error ? e : null;
      if (err?.name === 'AbortError' && requestId !== buildRequestId) {
        return;
      }
      console.error('Failed to build timeline components', e);
      if (requestId === buildRequestId) {
        loadError.value = err?.message || t('fastcat.monitor.loadError');
      }
      toast.add({
        color: 'error',
        title: t('fastcat.monitor.previewError'),
        description: err?.message || t('fastcat.monitor.loadError'),
      });
    } finally {
      if (requestId === buildRequestId) {
        isLoading.value = false;
      }
    }
  }

  registerMonitorCoreWatchers({
    clipSourceSignature,
    audioClipSourceSignature,
    clipLayoutSignature,
    audioClipLayoutSignature,
    rawWorkerTimelineClips,
    rawWorkerAudioClips,
    workerTimelineClips,
    workerAudioClips,
    existingProxies: proxyStore.existingProxies,
    useProxyInMonitor,
    previewEffectsEnabled,
    pixiRenderer,
    isLoading,
    getIsUnmounted: () => isUnmounted,
    getIsCompositorReady: compositorRuntime.isReady,
    getLastBuiltSourceSignature: () => lastBuiltSourceSignature,
    getLastBuiltLayoutSignature: () => lastBuiltLayoutSignature,
    getLastBuiltContentSignature: () => lastBuiltContentSignature,
    getLayoutUpdateFromQueue: () => layoutUpdateFromQueue,
    getTimelineMasterGain: () => timelineStore.masterGain,
    getTimelineAudioMuted: () => timelineStore.audioMuted,
    getMonitorVolume: () => uiStore.monitorVolume,
    getMonitorMuted: () => uiStore.monitorMuted,
    // Stable primitive key: `timelineFormat` is a computed off the whole doc, so
    // it returns a fresh object on every edit (including marker moves). Returning
    // an array here made the watch compare by reference and fire on every doc
    // change, needlessly invalidating the compositor + rebuilding (a visible
    // flicker). A string compares by value, so the watch fires only when the
    // dimensions actually change.
    getProjectSizeKey: () =>
      `${timelineStore.timelineFormat?.width ?? projectStore.projectSettings?.project?.width ?? 0}x${
        timelineStore.timelineFormat?.height ?? projectStore.projectSettings?.project?.height ?? 0
      }x${projectStore.activeMonitor?.previewResolution ?? 0}`,
    getRenderTimeForLayoutUpdate,
    stopPlayback: () => {
      timelineStore.isPlaying = false;
    },
    clearAudioHandleCache: () => {
      audioHandleCache.clear();
      forceRecreateCompositorNextBuild = true;
    },
    invalidateCompositor: compositorRuntime.invalidate,
    updateCanvasDisplaySize,
    scheduleBuild,
    scheduleRender,
    clipContentSignature,
    activeLayoutSignature,
    clipLayoutDebounceMs: 200,
    clipContentDebounceMs: 1000,
    audioLayoutDebounceMs: LAYOUT_DEBOUNCE_MS,
    scheduleLayoutUpdate,
    setAudioEngineMasterVolume: (volume) => {
      audioEngine.setMasterVolume(volume);
    },
    setAudioEngineMonitorVolume: (volume) => {
      audioEngine.setMonitorVolume(volume);
    },
  });

  onMounted(() => {
    initializeMonitorCoreRuntime({
      setUnmounted: (value) => {
        isUnmounted = value;
      },
      updateCanvasDisplaySize,
      scheduleBuild,
    });
    void broadcastPixiRendererPreference(workspaceStore.userSettings.optimization.pixiRenderer);
  });

  onBeforeUnmount(async () => {
    await disposeMonitorCoreRuntime({
      setUnmounted: (value) => {
        isUnmounted = value;
      },
      stopPlayback: () => {
        timelineStore.isPlaying = false;
      },
      clearPendingRender: compositorRuntime.clearPendingRender,
      clearQueues: queues.clear,
      destroyAudioEngine: () => {
        audioEngine.destroy();
      },
      destroyCompositor: compositorRuntime.destroy,
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
