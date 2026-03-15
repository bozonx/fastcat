import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { getPreviewWorkerClient, setPreviewHostApi } from '~/utils/video-editor/worker-client';

import { AudioEngine } from '~/utils/video-editor/AudioEngine';
import { clampTimeUs, normalizeTimeUs } from '~/utils/monitor-time';
import { createVideoCoreHostApi } from '~/utils/video-editor/createVideoCoreHostApi';

import type { WorkerTimelineClip } from './types';
import type { UseMonitorCoreOptions } from './useMonitorCore.types';
import {
  cloneWorkerPayload,
  computeAudioDurationUs,
  createPreviewRenderOptions,
} from './useMonitorCore.helpers';
import { mapAudioEngineClips } from './useMonitorCore.audio';
import { prepareMonitorTimelineData } from './useMonitorCore.payload';

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

  let viewportResizeObserver: ResizeObserver | null = null;
  let buildRequestId = 0;
  let lastBuiltSourceSignature = 0;
  let lastBuiltLayoutSignature = 0;
  let canvasEl: HTMLCanvasElement | null = null;
  let compositorReady = false;
  let compositorWidth = 0;
  let compositorHeight = 0;
  let buildInFlight = false;
  let buildRequested = false;
  let buildDebounceTimer: number | null = null;
  let layoutDebounceTimer: number | null = null;
  let layoutUpdateInFlight = false;
  let pendingLayoutClips: WorkerTimelineClip[] | null = null;
  let pendingLayoutAudioClips: WorkerTimelineClip[] | null = null;
  let renderLoopInFlight = false;
  let latestRenderTimeUs: number | null = null;
  let isUnmounted = false;
  let forceRecreateCompositorNextBuild = false;
  let currentTimeProvider: (() => number) | null = null;
  let layoutUpdateFromQueue = false;
  const audioHandleCache = new Map<string, FileSystemFileHandle>();

  const audioEngine = new AudioEngine();
  const { client } = getPreviewWorkerClient();

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
          const preparedTimeline = await prepareMonitorTimelineData({
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
          const audioDuration = computeAudioDurationUs(flattenedAudio);
          // Keep store duration at least as large as current value to avoid clamping
          // when disabled clips are excluded from the worker payload.
          timelineStore.duration = Math.max(timelineStore.duration, maxDuration, audioDuration);
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

  function scheduleRender(timeUs: number) {
    if (isUnmounted) return;
    latestRenderTimeUs = normalizeTimeUs(timeUs);
    if (renderLoopInFlight) return;

    renderLoopInFlight = true;
    const run = async () => {
      try {
        while (latestRenderTimeUs !== null) {
          if (isUnmounted) {
            latestRenderTimeUs = null;
            break;
          }
          const nextTimeUs = latestRenderTimeUs;
          latestRenderTimeUs = null;
          await client.renderFrame(nextTimeUs, getPreviewRenderOptions());
        }
      } catch (err) {
        console.error('[Monitor] Render failed', err);
      } finally {
        renderLoopInFlight = false;
        if (latestRenderTimeUs !== null) {
          scheduleRender(latestRenderTimeUs);
        }
      }
    };

    void run();
  }

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
    if (!containerEl.value) {
      return;
    }

    const shouldRecreate = options?.forceRecreate ?? false;
    const targetWidth = renderWidth.value;
    const targetHeight = renderHeight.value;
    const needReinit =
      !compositorReady ||
      compositorWidth !== targetWidth ||
      compositorHeight !== targetHeight ||
      shouldRecreate;

    if (!needReinit) {
      return;
    }

    if (shouldRecreate || !canvasEl || needReinit) {
      const container = containerEl.value;
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }
      canvasEl = document.createElement('canvas');
      canvasEl.style.width = `${targetWidth}px`;
      canvasEl.style.height = `${targetHeight}px`;
      canvasEl.style.display = 'block';
      containerEl.value.appendChild(canvasEl);
      compositorReady = false;
    }

    if (!canvasEl) {
      return;
    }

    canvasEl.width = targetWidth;
    canvasEl.height = targetHeight;
    canvasEl.style.width = `${targetWidth}px`;
    canvasEl.style.height = `${targetHeight}px`;
    const offscreen = canvasEl.transferControlToOffscreen();
    await client.destroyCompositor();
    await client.initCompositor(offscreen, targetWidth, targetHeight, '#000');
    compositorReady = true;
    compositorWidth = targetWidth;
    compositorHeight = targetHeight;
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

      const preparedTimeline = await prepareMonitorTimelineData({
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
      const audioDuration = computeAudioDurationUs(audioClips);

      if (clips.length === 0 && audioClips.length === 0) {
        await client.clearClips();
        await audioEngine.loadClips([]);
        timelineStore.duration = 0;
        updateStoreTime(0);
        isLoading.value = false;
        return;
      }

      setPreviewHostApi(
        createVideoCoreHostApi({
          getCurrentProjectId: () => currentProjectStore.currentProjectId,
          getWorkspaceHandle: () => workspaceStore.workspaceHandle,
          getResolvedStorageTopology: () => workspaceStore.resolvedStorageTopology,
          getFileHandleByPath: async (path) => {
            if (useProxyInMonitor.value) {
              const proxyHandle = await proxyStore.getProxyFileHandle(path);
              if (proxyHandle) return proxyHandle;
            }
            return await projectStore.getFileHandleByPath(path);
          },
          getFileByPath: async (path) => {
            if (useProxyInMonitor.value) {
              const proxyFile = await proxyStore.getProxyFile(path);
              if (proxyFile) return proxyFile;
            }
            return await projectStore.getFileByPath(path);
          },
          onExportProgress: () => {},
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
      timelineStore.duration = normalizeTimeUs(
        Math.max(timelineStore.duration, maxDuration, audioDuration),
      );

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

      // Check if any of the new proxies belong to clips in our timeline
      const clips = workerTimelineClips.value;
      const audio = workerAudioClips.value;

      const hasNewProxyForClips = [...clips, ...audio].some((c) => {
        const path = c.source?.path;
        if (!path) return false;
        // Since Set mutations don't provide deep old/new comparison easily,
        // we just check if it currently has a proxy. We should ideally check
        // if we weren't already using it, but this serves as a fallback.
        // The previous logic checked oldVal?.has(path), but in Vue oldVal === newVal
        // for mutated objects. We will just check if the new proxy is in our timeline.
        return newVal.has(path);
      });

      if (hasNewProxyForClips) {
        console.log('[Monitor] New proxies detected, rebuilding...');
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
      compositorReady = false;
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
    if (isLoading.value || !compositorReady) {
      return;
    }
    if (clipSourceSignature.value !== lastBuiltSourceSignature) {
      return;
    }
    if (clipLayoutSignature.value === lastBuiltLayoutSignature) {
      return;
    }
    if (layoutUpdateFromQueue) {
      return;
    }

    const layoutClips = rawWorkerTimelineClips?.value ?? workerTimelineClips.value;
    const layoutAudioClips = rawWorkerAudioClips?.value ?? workerAudioClips.value;
    scheduleLayoutUpdate(layoutClips, layoutAudioClips);
  });

  watch(audioClipLayoutSignature, () => {
    if (isLoading.value || !compositorReady) {
      return;
    }

    const layoutClips = rawWorkerTimelineClips?.value ?? workerTimelineClips.value;
    const layoutAudioClips = rawWorkerAudioClips?.value ?? workerAudioClips.value;
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
      compositorReady = false;
      scheduleBuild();
    },
  );

  onMounted(() => {
    isUnmounted = false;
    updateCanvasDisplaySize();
    if (typeof ResizeObserver !== 'undefined' && viewportEl.value) {
      let scheduled = false;
      viewportResizeObserver = new ResizeObserver(() => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
          scheduled = false;
          updateCanvasDisplaySize();
        });
      });
      viewportResizeObserver.observe(viewportEl.value);
    }
    scheduleBuild();
  });

  onBeforeUnmount(() => {
    isUnmounted = true;
    timelineStore.isPlaying = false;
    latestRenderTimeUs = null;
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

    viewportResizeObserver?.disconnect();
    viewportResizeObserver = null;
    pendingLayoutClips = null;
    pendingLayoutAudioClips = null;
    void client.destroyCompositor().catch((error) => {
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
