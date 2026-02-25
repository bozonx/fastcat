import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Ref } from 'vue';

import { AudioEngine } from '~/utils/video-editor/AudioEngine';
import { clampTimeUs, normalizeTimeUs } from '~/utils/monitor-time';
import { getPreviewWorkerClient, setPreviewHostApi } from '~/utils/video-editor/worker-client';
import { toWorkerTimelineClips } from '~/composables/timeline/useTimelineExport';

import type { WorkerTimelineClip } from './types';

interface MonitorTimelineState {
  videoItems: Ref<unknown[]>;
  rawWorkerTimelineClips?: Ref<WorkerTimelineClip[]>;
  rawWorkerAudioClips?: Ref<WorkerTimelineClip[]>;
  workerTimelineClips: Ref<WorkerTimelineClip[]>;
  workerAudioClips: Ref<WorkerTimelineClip[]>;
  safeDurationUs: Ref<number>;
  clipSourceSignature: Ref<number>;
  clipLayoutSignature: Ref<number>;
  audioClipSourceSignature: Ref<number>;
  audioClipLayoutSignature: Ref<number>;
}

interface MonitorDisplayState {
  containerEl: Ref<HTMLDivElement | null>;
  viewportEl: Ref<HTMLDivElement | null>;
  renderWidth: Ref<number>;
  renderHeight: Ref<number>;
  updateCanvasDisplaySize: () => void;
}

interface MonitorStoreState {
  projectStore: {
    projectSettings: any;
    getFileHandleByPath: (path: string) => Promise<FileSystemFileHandle | null>;
  };
  timelineStore: {
    duration: number;
    currentTime: number;
    isPlaying: boolean;
    audioVolume: number;
    audioMuted: boolean;
  };
  proxyStore: {
    getProxyFileHandle: (path: string) => Promise<FileSystemFileHandle | null>;
  };
}

export interface UseMonitorCoreOptions extends MonitorStoreState {
  monitorTimeline: MonitorTimelineState;
  monitorDisplay: MonitorDisplayState;
}

export function useMonitorCore(options: UseMonitorCoreOptions) {
  const { t } = useI18n();
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
  let renderLoopInFlight = false;
  let latestRenderTimeUs: number | null = null;
  let isUnmounted = false;
  let forceRecreateCompositorNextBuild = false;
  let currentTimeProvider: (() => number) | null = null;
  const audioHandleCache = new Map<string, FileSystemFileHandle>();

  const audioEngine = new AudioEngine();
  const { client } = getPreviewWorkerClient();

  const useProxyInMonitor = computed(() => {
    return projectStore.projectSettings.monitor?.useProxy !== false;
  });

  function cloneWorkerPayload<T>(value: T): T {
    try {
      if (typeof structuredClone === 'function') {
        return structuredClone(value);
      }
    } catch {
      // ignore and fallback
    }
    return JSON.parse(
      JSON.stringify(value, (_key, v) => {
        if (typeof v === 'function' || typeof v === 'symbol') return undefined;
        if (typeof v === 'bigint') return Number(v);
        if (v instanceof Map) return Array.from(v.entries());
        if (v instanceof Set) return Array.from(v.values());
        return v;
      }),
    );
  }

  function setCurrentTimeProvider(provider: () => number) {
    currentTimeProvider = provider;
  }

  function computeAudioDurationUs(clips: WorkerTimelineClip[]): number {
    let maxEnd = 0;
    for (const clip of clips) {
      const end = clip.timelineRange.startUs + clip.timelineRange.durationUs;
      if (end > maxEnd) maxEnd = end;
    }
    return maxEnd;
  }

  function getAudioSourceKey(path: string) {
    return `${useProxyInMonitor.value ? 'proxy' : 'source'}:${path}`;
  }

  async function getFileHandleForAudio(path: string) {
    const cacheKey = getAudioSourceKey(path);
    const cached = audioHandleCache.get(cacheKey);
    if (cached) return cached;
    if (useProxyInMonitor.value) {
      const proxyHandle = await proxyStore.getProxyFileHandle(path);
      if (proxyHandle) {
        audioHandleCache.set(cacheKey, proxyHandle);
        return proxyHandle;
      }
    }
    const handle = await projectStore.getFileHandleByPath(path);
    if (!handle) return null;
    audioHandleCache.set(cacheKey, handle);
    return handle;
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

  function scheduleLayoutUpdate(layoutClips: WorkerTimelineClip[]) {
    pendingLayoutClips = layoutClips;
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
      while (pendingLayoutClips) {
        const layoutClips = pendingLayoutClips;
        pendingLayoutClips = null;
        try {
          const payload = cloneWorkerPayload(layoutClips);
          const maxDuration = await client.updateTimelineLayout(payload);
          const audioDuration = computeAudioDurationUs(workerAudioClips.value);
          timelineStore.duration = Math.max(maxDuration, audioDuration);
          lastBuiltLayoutSignature = clipLayoutSignature.value;
          scheduleRender(getRenderTimeForLayoutUpdate());
        } catch (error) {
          console.error('[Monitor] Failed to update timeline layout', error);
          timelineStore.isPlaying = false;
          scheduleBuild();
        }
      }

      const audioClips = workerAudioClips.value;
      const audioEngineClips = (
        await Promise.all(
          audioClips.map(async (clip) => {
            try {
              const path = clip.source?.path;
              if (!path) return null;
              const handle = await getFileHandleForAudio(path);
              if (!handle) return null;
              return {
                id: clip.id,
                sourcePath: getAudioSourceKey(path),
                fileHandle: handle,
                startUs: clip.timelineRange.startUs,
                durationUs: clip.timelineRange.durationUs,
                sourceStartUs: clip.sourceRange.startUs,
                sourceDurationUs: clip.sourceRange.durationUs,
                speed: (clip as any).speed,
              };
            } catch {
              return null;
            }
          }),
        )
      ).filter((it): it is NonNullable<typeof it> => Boolean(it));

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
          await client.renderFrame(nextTimeUs);
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
    timelineStore.currentTime = normalizedTimeUs;
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
      containerEl.value.innerHTML = '';
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

      const rawClips = rawWorkerTimelineClips?.value ?? workerTimelineClips.value;
      const rawAudio = rawWorkerAudioClips?.value ?? workerAudioClips.value;

      const mockItems = rawClips.map(
        (c) =>
          ({
            kind: 'clip',
            clipType:
              c.clipType === 'media' && c.source?.path?.endsWith('.otio') ? 'timeline' : c.clipType,
            id: c.id,
            layer: c.layer,
            speed: (c as any).speed,
            source: c.source,
            timelineRange: c.timelineRange,
            sourceRange: c.sourceRange,
            freezeFrameSourceUs: c.freezeFrameSourceUs,
            opacity: c.opacity,
            effects: c.effects,
            transform: (c as any).transform,
            backgroundColor: c.backgroundColor,
          }) as any,
      );

      const mockAudioItems = rawAudio.map(
        (c) =>
          ({
            kind: 'clip',
            clipType:
              c.clipType === 'media' && c.source?.path?.endsWith('.otio') ? 'timeline' : c.clipType,
            id: c.id,
            speed: (c as any).speed,
            source: c.source,
            timelineRange: c.timelineRange,
            sourceRange: c.sourceRange,
            freezeFrameSourceUs: c.freezeFrameSourceUs,
            opacity: c.opacity,
            effects: c.effects,
            transform: (c as any).transform,
          }) as any,
      );

      const flattenedClips = await toWorkerTimelineClips(mockItems, projectStore as any);
      const flattenedAudio = await toWorkerTimelineClips(mockAudioItems, projectStore as any);

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

      setPreviewHostApi({
        getFileHandleByPath: async (path) => {
          if (useProxyInMonitor.value) {
            const proxyHandle = await proxyStore.getProxyFileHandle(path);
            if (proxyHandle) return proxyHandle;
          }
          return await projectStore.getFileHandleByPath(path);
        },
        onExportProgress: () => {},
      });

      const payload = cloneWorkerPayload(clips);
      const maxDuration = clips.length > 0 ? await client.loadTimeline(payload) : 0;
      if (clips.length === 0) {
        await client.clearClips();
      }

      await audioEngine.init();

      const audioEngineClips = (
        await Promise.all(
          audioClips.map(async (clip) => {
            try {
              const path = clip.source?.path;
              if (!path) return null;
              const handle = await getFileHandleForAudio(path);
              if (!handle) return null;
              return {
                id: clip.id,
                sourcePath: getAudioSourceKey(path),
                fileHandle: handle,
                startUs: clip.timelineRange.startUs,
                durationUs: clip.timelineRange.durationUs,
                sourceStartUs: clip.sourceRange.startUs,
                sourceDurationUs: clip.sourceRange.durationUs,
                speed: (clip as any).speed,
              };
            } catch {
              return null;
            }
          }),
        )
      ).filter((it): it is NonNullable<typeof it> => Boolean(it));
      await audioEngine.loadClips(audioEngineClips);

      lastBuiltSourceSignature = clipSourceSignature.value;
      lastBuiltLayoutSignature = clipLayoutSignature.value;

      timelineStore.duration = normalizeTimeUs(Math.max(maxDuration, audioDuration));
      updateStoreTime(timelineStore.currentTime);
      timelineStore.isPlaying = false;

      // Render at current time to avoid surprising playhead jumps.
      scheduleRender(getRenderTimeForLayoutUpdate());
    } catch (e: any) {
      console.error('Failed to build timeline components', e);
      if (requestId === buildRequestId) {
        loadError.value =
          e.message || t('granVideoEditor.monitor.loadError', 'Error loading timeline');
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

    const layoutClips = workerTimelineClips.value;
    scheduleLayoutUpdate(layoutClips);
  });

  watch(audioClipLayoutSignature, () => {
    if (isLoading.value || !compositorReady) {
      return;
    }

    const layoutClips = workerTimelineClips.value;
    scheduleLayoutUpdate(layoutClips);
  });

  watch(
    () => [timelineStore.audioVolume, timelineStore.audioMuted],
    () => {
      const effectiveVolume = timelineStore.audioMuted ? 0 : timelineStore.audioVolume;
      audioEngine.setVolume(effectiveVolume);
    },
    { immediate: true },
  );

  watch(
    () => [
      projectStore.projectSettings.export.width,
      projectStore.projectSettings.export.height,
      projectStore.projectSettings.monitor?.previewResolution,
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
    }

    try {
      audioEngine.destroy();
    } catch (err) {
      console.error('[Monitor] Failed to destroy AudioEngine', err);
    }

    viewportResizeObserver?.disconnect();
    viewportResizeObserver = null;
    pendingLayoutClips = null;
    void client.destroyCompositor().catch((error) => {
      console.error('[Monitor] Failed to destroy compositor on unmount', error);
    });
  });

  return {
    audioEngine,
    clampToTimeline,
    isLoading,
    loadError,
    scheduleBuild,
    scheduleRender,
    setCurrentTimeProvider,
    updateStoreTime,
    useProxyInMonitor,
  };
}
