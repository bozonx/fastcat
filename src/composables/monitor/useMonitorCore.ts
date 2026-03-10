import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Ref } from 'vue';
import type { GranVideoEditorProjectSettings } from '~/utils/project-settings';
import type { TimelineDocument } from '~/timeline/types';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { getPreviewWorkerClient, setPreviewHostApi } from '~/utils/video-editor/worker-client';

import { AudioEngine } from '~/utils/video-editor/AudioEngine';
import { clampTimeUs, normalizeTimeUs } from '~/utils/monitor-time';
import { createVideoCoreHostApi } from '~/utils/video-editor/createVideoCoreHostApi';
import type { PreviewRenderOptions } from '~/utils/video-editor/worker-rpc';
import {
  buildVideoWorkerPayloadFromTracks,
  toWorkerTimelineClips,
} from '~/composables/timeline/useTimelineExport';

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

interface TimelineStoreState {
  duration: number;
  currentTime: number;
  setCurrentTimeUs: (timeUs: number) => void;
  isPlaying: boolean;
  masterGain: number;
  audioMuted: boolean;
  timelineDoc: TimelineDocument | null;
}

interface MonitorStoreState {
  projectStore: {
    projectSettings: GranVideoEditorProjectSettings;
    getFileHandleByPath: (path: string) => Promise<FileSystemFileHandle | null>;
    getFileByPath: (path: string) => Promise<File | null>;
  };
  timelineStore: TimelineStoreState;
  proxyStore: {
    getProxyFileHandle: (path: string) => Promise<FileSystemFileHandle | null>;
    getProxyFile: (path: string) => Promise<File | null>;
  };
}

export interface UseMonitorCoreOptions extends MonitorStoreState {
  monitorTimeline: MonitorTimelineState;
  monitorDisplay: MonitorDisplayState;
}

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
  const audioHandleCache = new Map<string, FileSystemFileHandle>();

  const audioEngine = new AudioEngine();
  const { client } = getPreviewWorkerClient();

  const useProxyInMonitor = computed(() => {
    return projectStore.projectSettings.monitor?.useProxy !== false;
  });

  const previewEffectsEnabled = computed(() => {
    return projectStore.projectSettings.monitor?.previewEffectsEnabled !== false;
  });

  function getPreviewRenderOptions(): PreviewRenderOptions {
    return {
      previewEffectsEnabled: previewEffectsEnabled.value,
    };
  }

  function cloneWorkerPayload<T>(value: T): T {
    try {
      if (typeof structuredClone === 'function') {
        return structuredClone(value);
      }
    } catch {
      // ignore and fallback
    }
    return value;
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
          const mockAudioItems = layoutAudioClips.map(
            (c) =>
              ({
                kind: 'clip',
                clipType:
                  c.clipType === 'media' && c.source?.path?.endsWith('.otio')
                    ? 'timeline'
                    : c.clipType,
                id: c.id,
                trackId: c.trackId,
                speed: (c as any).speed,
                audioGain: (c as any).audioGain,
                audioBalance: (c as any).audioBalance,
                audioFadeInUs: (c as any).audioFadeInUs,
                audioFadeOutUs: (c as any).audioFadeOutUs,
                audioDeclickDurationUs: (c as any).audioDeclickDurationUs,
                source: c.source,
                timelineRange: c.timelineRange,
                sourceRange: c.sourceRange,
                freezeFrameSourceUs: c.freezeFrameSourceUs,
                opacity: c.opacity,
                blendMode: c.blendMode,
                effects: c.effects,
                transform: (c as any).transform,
              }) as any,
          );

          const builtVideo = await buildVideoWorkerPayloadFromTracks({
            tracks: timelineStore.timelineDoc?.tracks ?? [],
            projectStore: projectStore as any,
            masterEffects: timelineStore.timelineDoc?.metadata?.gran?.masterEffects,
          });
          const flattenedClips = builtVideo.clips;
          const flattenedAudio = await toWorkerTimelineClips(mockAudioItems, projectStore as any);

          workerTimelineClips.value = flattenedClips;
          workerAudioClips.value = flattenedAudio;

          const payload = cloneWorkerPayload(builtVideo.payload);
          const maxDuration = await client.updateTimelineLayout(payload);
          const audioDuration = computeAudioDurationUs(flattenedAudio);
          // Keep store duration at least as large as current value to avoid clamping
          // when disabled clips are excluded from the worker payload.
          timelineStore.duration = Math.max(timelineStore.duration, maxDuration, audioDuration);
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
          audioClips.map(async (clip: WorkerTimelineClip) => {
            try {
              const path = clip.source?.path;
              if (!path) return null;
              const handle = await getFileHandleForAudio(path);
              if (!handle) return null;
              return {
                id: clip.id,
                trackId: clip.trackId,
                sourcePath: getAudioSourceKey(path),
                fileHandle: handle,
                startUs: clip.timelineRange.startUs,
                durationUs: clip.timelineRange.durationUs,
                sourceStartUs: clip.sourceRange.startUs,
                sourceRangeDurationUs: clip.sourceRange.durationUs,
                sourceDurationUs: clip.sourceDurationUs ?? clip.sourceRange.durationUs,
                speed: (clip as any).speed,
                reversed: (clip as any).reversed,
                audioGain: (clip as any).audioGain,
                audioBalance: (clip as any).audioBalance,
                audioFadeInUs: (clip as any).audioFadeInUs,
                audioFadeOutUs: (clip as any).audioFadeOutUs,
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

      const rawAudio = rawWorkerAudioClips?.value ?? workerAudioClips.value;

      const mockAudioItems = rawAudio.map(
        (c) =>
          ({
            kind: 'clip',
            clipType:
              c.clipType === 'media' && c.source?.path?.endsWith('.otio') ? 'timeline' : c.clipType,
            id: c.id,
            trackId: c.trackId,
            audioBalance: (c as any).audioBalance,
            speed: (c as any).speed,
            audioGain: (c as any).audioGain,
            audioFadeInUs: (c as any).audioFadeInUs,
            audioFadeOutUs: (c as any).audioFadeOutUs,
            source: c.source,
            timelineRange: c.timelineRange,
            sourceRange: c.sourceRange,
            freezeFrameSourceUs: c.freezeFrameSourceUs,
            opacity: c.opacity,
            blendMode: c.blendMode,
            effects: c.effects,
            transform: (c as any).transform,
          }) as any,
      );

      const builtVideo = await buildVideoWorkerPayloadFromTracks({
        tracks: timelineStore.timelineDoc?.tracks ?? [],
        projectStore: projectStore as any,
        masterEffects: timelineStore.timelineDoc?.metadata?.gran?.masterEffects,
      });
      const flattenedClips = builtVideo.clips;
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

      setPreviewHostApi(
        createVideoCoreHostApi({
          getCurrentProjectId: () => currentProjectStore.currentProjectId,
          getWorkspaceHandle: () => workspaceStore.workspaceHandle,
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

      const payload = cloneWorkerPayload(builtVideo.payload);
      const maxDuration = clips.length > 0 ? await client.loadTimeline(payload) : 0;
      if (clips.length === 0) {
        await client.clearClips();
      }

      await audioEngine.init({
        sampleRate: projectStore.projectSettings?.project?.sampleRate,
        audioChannels: projectStore.projectSettings?.project?.audioChannels,
      });

      const audioEngineClipCandidates: Array<{
        id: string;
        trackId?: string;
        sourcePath: string;
        fileHandle: FileSystemFileHandle;
        startUs: number;
        durationUs: number;
        sourceStartUs: number;
        sourceRangeDurationUs: number;
        sourceDurationUs: number;
        speed?: number;
        audioGain?: number;
        audioBalance?: number;
        audioFadeInUs?: number;
        audioFadeOutUs?: number;
      } | null> = await Promise.all(
        audioClips.map(async (clip: WorkerTimelineClip) => {
          try {
            const path = clip.source?.path;
            if (!path) return null;
            const handle = await getFileHandleForAudio(path);
            if (!handle) return null;
            return {
              id: clip.id,
              trackId: clip.trackId,
              sourcePath: getAudioSourceKey(path),
              fileHandle: handle,
              startUs: clip.timelineRange.startUs,
              durationUs: clip.timelineRange.durationUs,
              sourceStartUs: clip.sourceRange.startUs,
              sourceRangeDurationUs: clip.sourceRange.durationUs,
              sourceDurationUs: clip.sourceDurationUs ?? clip.sourceRange.durationUs,
              speed: (clip as any).speed,
              reversed: (clip as any).reversed,
              audioGain: (clip as any).audioGain,
              audioBalance: (clip as any).audioBalance,
              audioFadeInUs: (clip as any).audioFadeInUs,
              audioFadeOutUs: (clip as any).audioFadeOutUs,
            };
          } catch {
            return null;
          }
        }),
      );
      const audioEngineClips = audioEngineClipCandidates.filter(
        (it): it is NonNullable<typeof it> => Boolean(it),
      );
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
