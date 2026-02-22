<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, computed } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { getPreviewWorkerClient, setPreviewHostApi } from '~/utils/video-editor/worker-client';
import { clampTimeUs, normalizeTimeUs, sanitizeFps } from '~/utils/monitor-time';
import { useMonitorTimeline } from '~/composables/monitor/useMonitorTimeline';
import { useMonitorDisplay } from '~/composables/monitor/useMonitorDisplay';
import type { WorkerTimelineClip } from '~/composables/monitor/types';

const { t } = useI18n();
const projectStore = useProjectStore();
const timelineStore = useTimelineStore();

const loadError = ref<string | null>(null);
const isLoading = ref(false);

const {
  videoItems,
  workerTimelineClips,
  safeDurationUs,
  clipSourceSignature,
  clipLayoutSignature,
} = useMonitorTimeline();

const {
  containerEl,
  viewportEl,
  exportWidth,
  exportHeight,
  getCanvasWrapperStyle,
  getCanvasInnerStyle,
  updateCanvasDisplaySize,
} = useMonitorDisplay();

const canInteractPlayback = computed(
  () => videoItems.value.length > 0 && !isLoading.value && !loadError.value,
);

// Internal state for timeline build and layout
const BUILD_DEBOUNCE_MS = 120;
const LAYOUT_DEBOUNCE_MS = 50;
const STORE_TIME_SYNC_MS = 100;

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
let suppressStoreSeekWatch = false;

const { client } = getPreviewWorkerClient();

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
        scheduleRender(localCurrentTimeUs);
      } catch (error) {
        console.error('[Monitor] Failed to update timeline layout', error);
      }
    }
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
  suppressStoreSeekWatch = true;
  timelineStore.currentTime = normalizedTimeUs;
  suppressStoreSeekWatch = false;
}

function clampToTimeline(timeUs: number): number {
  return clampTimeUs(timeUs, safeDurationUs.value);
}

async function ensureCompositorReady(options?: { forceRecreate?: boolean }) {
  if (!containerEl.value) {
    return;
  }

  const shouldRecreate = options?.forceRecreate ?? false;
  const targetWidth = exportWidth.value;
  const targetHeight = exportHeight.value;
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
    canvasEl.style.width = '100%';
    canvasEl.style.height = '100%';
    canvasEl.style.display = 'block';
    containerEl.value.appendChild(canvasEl);
    compositorReady = false;
  }

  if (!canvasEl) {
    return;
  }

  canvasEl.width = targetWidth;
  canvasEl.height = targetHeight;
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
    await ensureCompositorReady();
    const clips = workerTimelineClips.value;
    if (clips.length === 0) {
      await client.clearClips();
      timelineStore.duration = 0;
      localCurrentTimeUs = 0;
      uiCurrentTimeUs.value = 0;
      updateStoreTime(0);
      isLoading.value = false;
      return;
    }

    setPreviewHostApi({
      getFileHandleByPath: async (path) => projectStore.getFileHandleByPath(path),
      onExportProgress: () => {},
    });

    const maxDuration = await client.loadTimeline(clips);

    lastBuiltSourceSignature = clipSourceSignature.value;
    lastBuiltLayoutSignature = clipLayoutSignature.value;

    timelineStore.duration = normalizeTimeUs(maxDuration);

    localCurrentTimeUs = 0;
    uiCurrentTimeUs.value = 0;
    updateStoreTime(0);
    timelineStore.isPlaying = false;
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

watch(
  () => [projectStore.projectSettings.export.width, projectStore.projectSettings.export.height],
  () => {
    updateCanvasDisplaySize();
    compositorReady = false;
    scheduleBuild();
  },
);

// Playback loop state
let playbackLoopId = 0;
let lastFrameTimeMs = 0;
let localCurrentTimeUs = 0;
const uiCurrentTimeUs = ref(0);
let renderAccumulatorMs = 0;
let storeSyncAccumulatorMs = 0;

function updatePlayback(timestamp: number) {
  if (!timelineStore.isPlaying) return;

  const deltaMsRaw = timestamp - lastFrameTimeMs;
  const deltaMs = Number.isFinite(deltaMsRaw) && deltaMsRaw > 0 ? deltaMsRaw : 0;
  lastFrameTimeMs = timestamp;
  renderAccumulatorMs += deltaMs;
  storeSyncAccumulatorMs += deltaMs;

  let newTimeUs = clampToTimeline(localCurrentTimeUs + deltaMs * 1000);

  if (newTimeUs >= safeDurationUs.value) {
    newTimeUs = safeDurationUs.value;
    timelineStore.isPlaying = false;
    localCurrentTimeUs = newTimeUs;
    uiCurrentTimeUs.value = newTimeUs;
    updateStoreTime(newTimeUs);
    scheduleRender(newTimeUs);
    return;
  }

  localCurrentTimeUs = newTimeUs;
  uiCurrentTimeUs.value = newTimeUs;

  if (storeSyncAccumulatorMs >= STORE_TIME_SYNC_MS) {
    storeSyncAccumulatorMs = 0;
    updateStoreTime(newTimeUs);
  }

  const fps = sanitizeFps(projectStore.projectSettings?.export?.fps);
  const frameIntervalMs = 1000 / fps;

  if (renderAccumulatorMs >= frameIntervalMs) {
    renderAccumulatorMs %= frameIntervalMs;
    scheduleRender(newTimeUs);
  }

  if (timelineStore.isPlaying) {
    playbackLoopId = requestAnimationFrame(updatePlayback);
  }
}

watch(
  () => timelineStore.isPlaying,
  (playing) => {
    if (isLoading.value || loadError.value) {
      if (playing) timelineStore.isPlaying = false;
      return;
    }

    if (playing) {
      if (localCurrentTimeUs >= safeDurationUs.value) {
        localCurrentTimeUs = 0;
        uiCurrentTimeUs.value = 0;
        updateStoreTime(0);
      }
      localCurrentTimeUs = clampToTimeline(timelineStore.currentTime);
      uiCurrentTimeUs.value = localCurrentTimeUs;
      lastFrameTimeMs = performance.now();
      renderAccumulatorMs = 0;
      storeSyncAccumulatorMs = 0;
      playbackLoopId = requestAnimationFrame(updatePlayback);
    } else {
      cancelAnimationFrame(playbackLoopId);
      updateStoreTime(clampToTimeline(localCurrentTimeUs));
    }
  },
);

// Sync time to store (initial seek or external seek)
watch(
  () => timelineStore.currentTime,
  (val) => {
    if (suppressStoreSeekWatch) {
      return;
    }
    const normalizedTimeUs = clampToTimeline(val);
    if (normalizedTimeUs !== val) {
      updateStoreTime(normalizedTimeUs);
      return;
    }
    if (!timelineStore.isPlaying) {
      localCurrentTimeUs = normalizedTimeUs;
      uiCurrentTimeUs.value = normalizedTimeUs;
      scheduleRender(normalizedTimeUs);
    }
  },
);

onMounted(() => {
  isUnmounted = false;
  localCurrentTimeUs = clampToTimeline(timelineStore.currentTime);
  uiCurrentTimeUs.value = localCurrentTimeUs;
  updateCanvasDisplaySize();
  if (typeof ResizeObserver !== 'undefined' && viewportEl.value) {
    viewportResizeObserver = new ResizeObserver(() => {
      updateCanvasDisplaySize();
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
  viewportResizeObserver?.disconnect();
  viewportResizeObserver = null;
  cancelAnimationFrame(playbackLoopId);
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
</script>

<template>
  <div class="flex flex-col h-full bg-gray-950">
    <!-- Header -->
    <div class="flex items-center px-3 py-2 border-b border-gray-700 shrink-0">
      <span class="text-xs font-semibold text-gray-400 uppercase tracking-wider">
        {{ t('granVideoEditor.monitor.title', 'Monitor') }}
      </span>
    </div>

    <!-- Video area -->
    <div ref="viewportEl" class="flex-1 flex items-center justify-center overflow-hidden relative">
      <div v-if="videoItems.length === 0" class="flex flex-col items-center gap-3 text-gray-700">
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

      <div
        class="shrink-0"
        :style="getCanvasWrapperStyle()"
        :class="{ invisible: loadError || videoItems.length === 0 }"
      >
        <div ref="containerEl" :style="getCanvasInnerStyle()" />
      </div>
    </div>

    <!-- Playback controls -->
    <div class="flex items-center justify-center gap-3 px-4 py-3 border-t border-gray-700 shrink-0">
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
        @click="timelineStore.isPlaying = !timelineStore.isPlaying"
      />
      <span class="text-xs text-gray-600 ml-2 font-mono">
        {{ formatTime(uiCurrentTimeUs / 1e6) }} / {{ formatTime(timelineStore.duration / 1e6) }}
      </span>
    </div>
  </div>
</template>
