<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProxyStore } from '~/stores/proxy.store';
import { getPreviewWorkerClient, setPreviewHostApi } from '~/utils/video-editor/worker-client';
import { AudioEngine } from '~/utils/video-editor/AudioEngine';
import { clampTimeUs, normalizeTimeUs } from '~/utils/monitor-time';
import { useMonitorTimeline } from '~/composables/monitor/useMonitorTimeline';
import { useMonitorDisplay } from '~/composables/monitor/useMonitorDisplay';
import { useMonitorPlayback } from '~/composables/monitor/useMonitorPlayback';
import type { WorkerTimelineClip } from '~/composables/monitor/types';

const { t } = useI18n();
const projectStore = useProjectStore();
const timelineStore = useTimelineStore();
const proxyStore = useProxyStore();
const { isPlaying, currentTime, duration } = storeToRefs(timelineStore);

const loadError = ref<string | null>(null);
const isLoading = ref(false);

const {
  videoItems,
  workerTimelineClips,
  workerAudioClips,
  safeDurationUs,
  clipSourceSignature,
  clipLayoutSignature,
  audioClipSourceSignature,
  audioClipLayoutSignature,
} = useMonitorTimeline();

const {
  containerEl,
  viewportEl,
  renderWidth,
  renderHeight,
  getCanvasWrapperStyle,
  getCanvasInnerStyle,
  updateCanvasDisplaySize,
} = useMonitorDisplay();

const canInteractPlayback = computed(
  () => !isLoading.value && (safeDurationUs.value > 0 || videoItems.value.length > 0),
);

const previewResolutions = [
  { label: '1080p', value: 1080 },
  { label: '720p', value: 720 },
  { label: '480p', value: 480 },
  { label: '360p', value: 360 },
  { label: '240p', value: 240 },
  { label: '144p', value: 144 },
];

// Internal state for timeline build and layout
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

const audioEngine = new AudioEngine();

const timecodeEl = ref<HTMLElement | null>(null);

const { client } = getPreviewWorkerClient();

const useProxyInMonitor = computed(() => {
  return projectStore.projectSettings.monitor?.useProxy !== false;
});

async function getFileHandleForAudio(path: string) {
  const handle = await projectStore.getFileHandleByPath(path);
  if (!handle) return null;
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

async function flushLayoutUpdateQueue() {
  if (layoutUpdateInFlight || isUnmounted) return;

  layoutUpdateInFlight = true;
  try {
    while (pendingLayoutClips) {
      const layoutClips = pendingLayoutClips;
      pendingLayoutClips = null;
      try {
        const maxDuration = await client.updateTimelineLayout(layoutClips);
        timelineStore.duration = maxDuration;
        lastBuiltLayoutSignature = clipLayoutSignature.value;
        scheduleRender(getLocalCurrentTimeUs());
      } catch (error) {
        console.error('[Monitor] Failed to update timeline layout', error);
      }
    }

    // Also update audio clips (both dedicated audio tracks and audio from video clips)
    const audioClips = workerAudioClips.value;
    const audioEngineClips = (
      await Promise.all(
        audioClips.map(async (clip) => {
          try {
            const handle = await getFileHandleForAudio(clip.source.path);
            if (!handle) return null;
            return {
              id: clip.id,
              sourcePath: clip.source.path,
              fileHandle: handle,
              startUs: clip.timelineRange.startUs,
              durationUs: clip.timelineRange.durationUs,
              sourceStartUs: clip.sourceRange.startUs,
              sourceDurationUs: clip.sourceRange.durationUs,
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
    const clips = workerTimelineClips.value;
    const audioClips = workerAudioClips.value;

    if (clips.length === 0 && audioClips.length === 0) {
      await client.clearClips();
      await audioEngine.loadClips([]);
      timelineStore.duration = 0;
      updateStoreTime(0);
      setLocalTimeFromStore();
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

    const maxDuration = await client.loadTimeline(clips);

    await audioEngine.init();

    const audioEngineClips = (
      await Promise.all(
        audioClips.map(async (clip) => {
          try {
            const handle = await getFileHandleForAudio(clip.source.path);
            if (!handle) return null;
            return {
              id: clip.id,
              sourcePath: clip.source.path,
              fileHandle: handle,
              startUs: clip.timelineRange.startUs,
              durationUs: clip.timelineRange.durationUs,
              sourceStartUs: clip.sourceRange.startUs,
              sourceDurationUs: clip.sourceRange.durationUs,
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

    timelineStore.duration = normalizeTimeUs(maxDuration);
    updateStoreTime(0);
    setLocalTimeFromStore();
    isPlaying.value = false;
    scheduleRender(0);
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

    // Playback needs to stop, and we force a compositor re-init to avoid worker-side resource reuse.
    isPlaying.value = false;
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

const { uiCurrentTimeUs, getLocalCurrentTimeUs, setTimecodeEl, setLocalTimeFromStore } =
  useMonitorPlayback({
    isLoading,
    loadError,
    isPlaying,
    currentTime,
    duration,
    safeDurationUs,
    getFps: () => projectStore.projectSettings?.export?.fps,
    clampToTimeline,
    updateStoreTime,
    scheduleRender,
    audioEngine,
  });

onMounted(() => {
  isUnmounted = false;
  setTimecodeEl(timecodeEl.value);
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

  // Cleanup AudioEngine to prevent AudioContext and WebWorker leaks across HMR / unmounts
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

function formatTime(seconds: number): string {
  if (isNaN(seconds)) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function togglePlayback() {
  if (isLoading.value) return;

  // Unblock Web Audio strictly inside the synchronous user gesture handler
  audioEngine.resumeContext();

  // If preview build failed, attempt a rebuild instead of permanently blocking playback controls.
  if (loadError.value) {
    loadError.value = null;
    scheduleBuild();
    return;
  }

  timelineStore.isPlaying = !timelineStore.isPlaying;
}
</script>

<template>
  <div class="flex flex-col h-full bg-ui-bg-elevated border-r border-ui-border min-w-0 min-h-0">
    <!-- Header -->
    <div
      class="flex items-center justify-between px-3 py-2 border-b border-ui-border shrink-0 h-10"
    >
      <span class="text-xs font-semibold text-gray-400 uppercase tracking-wider">
        {{ t('granVideoEditor.monitor.title', 'Monitor') }}
      </span>
      <div class="flex items-center gap-2 shrink-0">
        <UTooltip :text="t('granVideoEditor.monitor.useProxy', 'Use proxy')">
          <UButton
            v-if="projectStore.projectSettings.monitor"
            size="xs"
            :color="useProxyInMonitor ? 'primary' : 'neutral'"
            :variant="useProxyInMonitor ? 'soft' : 'ghost'"
            icon="i-heroicons-bolt"
            @click="projectStore.projectSettings.monitor.useProxy = !useProxyInMonitor"
          />
        </UTooltip>

        <div class="w-24">
          <USelectMenu
            v-if="projectStore.projectSettings.monitor"
            :model-value="
              (previewResolutions.find(
                (r) => r.value === projectStore.projectSettings.monitor.previewResolution,
              ) || previewResolutions[2]) as any
            "
            :items="previewResolutions"
            value-key="value"
            label-key="label"
            size="xs"
            class="w-full"
            @update:model-value="
              (v: any) => {
                if (v) projectStore.projectSettings.monitor.previewResolution = v.value ?? v;
              }
            "
          />
        </div>
      </div>
    </div>

    <!-- Video area -->
    <div
      ref="viewportEl"
      class="flex-1 min-h-0 min-w-0 overflow-hidden relative"
    >
      <div class="absolute inset-0 flex items-center justify-center">
        <div class="shrink-0" :style="getCanvasWrapperStyle()">
          <div ref="containerEl" :style="getCanvasInnerStyle()" />
        </div>

        <div
          v-if="videoItems.length === 0"
          class="absolute inset-0 flex flex-col items-center justify-center gap-3 text-gray-700"
        >
          <UIcon name="i-heroicons-play-circle" class="w-16 h-16" />
          <p class="text-sm">
            {{ t('granVideoEditor.monitor.empty', 'No clip selected') }}
          </p>
        </div>

        <div
          v-else-if="isLoading"
          class="absolute inset-0 flex items-center justify-center text-gray-400"
        >
          <UIcon name="i-heroicons-arrow-path" class="w-8 h-8 animate-spin" />
        </div>

        <div
          v-else-if="loadError"
          class="absolute inset-0 flex items-center justify-center text-red-500"
        >
          {{ loadError }}
        </div>
      </div>
    </div>

    <!-- Playback controls -->
    <div
      class="flex items-center justify-center gap-3 px-4 py-3 border-t border-ui-border shrink-0"
    >
      <UButton
        size="sm"
        variant="ghost"
        color="neutral"
        icon="i-heroicons-backward"
        :aria-label="t('granVideoEditor.monitor.rewind', 'Rewind')"
        :disabled="!canInteractPlayback"
        @click="timelineStore.currentTime = 0"
      />
      <UButton
        size="sm"
        variant="solid"
        color="primary"
        :icon="timelineStore.isPlaying ? 'i-heroicons-pause' : 'i-heroicons-play'"
        :aria-label="t('granVideoEditor.monitor.play', 'Play')"
        :disabled="!canInteractPlayback"
        @click="togglePlayback"
      />
      <span ref="timecodeEl" class="text-xs text-gray-600 ml-2 font-mono">
        {{ formatTime(uiCurrentTimeUs / 1e6) }} / {{ formatTime(timelineStore.duration / 1e6) }}
      </span>
    </div>
  </div>
</template>
