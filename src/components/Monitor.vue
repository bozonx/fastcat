<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProxyStore } from '~/stores/proxy.store';
import { useFocusStore } from '~/stores/focus.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useMonitorTimeline } from '~/composables/monitor/useMonitorTimeline';
import { useMonitorDisplay } from '~/composables/monitor/useMonitorDisplay';
import { useMonitorPlayback } from '~/composables/monitor/useMonitorPlayback';
import { useMonitorCore } from '~/composables/monitor/useMonitorCore';
import WheelSlider from '~/components/ui/WheelSlider.vue';
import { buildStopFrameBaseName } from '~/utils/stop-frames';
import { getExportWorkerClient, setExportHostApi } from '~/utils/video-editor/worker-client';
import { SOURCES_DIR_NAME } from '~/utils/constants';

const { t } = useI18n();
const toast = useToast();
const projectStore = useProjectStore();
const timelineStore = useTimelineStore();
const proxyStore = useProxyStore();
const focusStore = useFocusStore();
const workspaceStore = useWorkspaceStore();
const { isPlaying, currentTime, duration, audioVolume, audioMuted } = storeToRefs(timelineStore);

const playbackSpeedOptions = [
  { label: '0.5x', value: 0.5 },
  { label: '0.75x', value: 0.75 },
  { label: '1x', value: 1 },
  { label: '1.25x', value: 1.25 },
  { label: '1.5x', value: 1.5 },
  { label: '1.75x', value: 1.75 },
  { label: '2x', value: 2 },
  { label: '3x', value: 3 },
  { label: '5x', value: 5 },
];

const playbackDirection = computed(() =>
  timelineStore.playbackSpeed < 0 ? 'backward' : 'forward',
);

const selectedPlaybackSpeedOption = computed(() => {
  const abs = Math.abs(timelineStore.playbackSpeed);
  return playbackSpeedOptions.find((o) => o.value === abs) ?? playbackSpeedOptions[2];
});

const {
  videoItems,
  workerTimelineClips,
  workerAudioClips,
  rawWorkerTimelineClips,
  rawWorkerAudioClips,
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

const {
  isLoading,
  loadError,
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
  proxyStore,
  monitorTimeline: {
    videoItems,
    workerTimelineClips,
    workerAudioClips,
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

const canInteractPlayback = computed(
  () => !isLoading.value && (safeDurationUs.value > 0 || videoItems.value.length > 0),
);

function blurActiveElement() {
  (document.activeElement as HTMLElement | null)?.blur?.();
}

const previewResolutions = computed(() => {
  const projectHeight = projectStore.projectSettings.export.height;
  const baseResolutions = [
    { label: '2160p', value: 2160 },
    { label: '1440p', value: 1440 },
    { label: '1080p', value: 1080 },
    { label: '720p', value: 720 },
    { label: '480p', value: 480 },
    { label: '360p', value: 360 },
    { label: '240p', value: 240 },
    { label: '144p', value: 144 },
  ];

  return baseResolutions.map((res) => ({
    ...res,
    isProject: res.value === projectHeight,
  }));
});

const timecodeEl = ref<HTMLElement | null>(null);
const { uiCurrentTimeUs, getLocalCurrentTimeUs, setTimecodeEl } = useMonitorPlayback({
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

setCurrentTimeProvider(getLocalCurrentTimeUs);

onMounted(() => {
  setTimecodeEl(timecodeEl.value);
  timelineStore.setPlaybackGestureHandler((nextPlaying) => {
    if (nextPlaying) {
      audioEngine.resumeContext();
    }
  });
});

const isPreviewSelected = ref(false);

const isPanning = ref(false);
const panStart = ref({ x: 0, y: 0 });
const panOrigin = ref({ x: 0, y: 0 });

const panX = computed({
  get: () => projectStore.projectSettings.monitor?.panX ?? 0,
  set: (v: number) => {
    if (!projectStore.projectSettings.monitor) return;
    projectStore.projectSettings.monitor.panX = v;
  },
});

const panY = computed({
  get: () => projectStore.projectSettings.monitor?.panY ?? 0,
  set: (v: number) => {
    if (!projectStore.projectSettings.monitor) return;
    projectStore.projectSettings.monitor.panY = v;
  },
});

const workspaceStyle = computed(() => {
  return {
    transform: `translate(${panX.value}px, ${panY.value}px)`,
  };
});

function centerMonitor() {
  if (!projectStore.projectSettings.monitor) return;
  projectStore.projectSettings.monitor.panX = 0;
  projectStore.projectSettings.monitor.panY = 0;
}

function onPreviewPointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  isPreviewSelected.value = true;
  event.stopPropagation();
}

function onViewportPointerDown(event: PointerEvent) {
  const workspaceStore = useWorkspaceStore();
  const settings = workspaceStore.userSettings?.mouse?.monitor;

  // Middle click (button 1)
  if (event.button === 1) {
    if (settings?.middleClick === 'pan') {
      isPanning.value = true;
      panStart.value = { x: event.clientX, y: event.clientY };
      panOrigin.value = { x: panX.value, y: panY.value };
      (event.currentTarget as HTMLElement | null)?.setPointerCapture(event.pointerId);
      event.preventDefault();
    }
    return;
  }
}

function onViewportPointerMove(event: PointerEvent) {
  if (!isPanning.value) return;
  const dx = event.clientX - panStart.value.x;
  const dy = event.clientY - panStart.value.y;
  panX.value = panOrigin.value.x + dx;
  panY.value = panOrigin.value.y + dy;
}

function stopPan(event?: PointerEvent) {
  if (!isPanning.value) return;
  isPanning.value = false;
  if (event) {
    try {
      (event.currentTarget as HTMLElement | null)?.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  }
}

function onWindowPointerUp() {
  isPanning.value = false;
}

onMounted(() => {
  window.addEventListener('pointerup', onWindowPointerUp);
});

onBeforeUnmount(() => {
  window.removeEventListener('pointerup', onWindowPointerUp);
});

function onViewportWheel(e: WheelEvent) {
  if (e.defaultPrevented) return;

  const isShift = e.shiftKey;
  const workspaceStore = useWorkspaceStore();
  const settings = workspaceStore.userSettings?.mouse?.monitor;
  if (!settings) return;

  const action = isShift ? settings.wheelShift : settings.wheel;

  if (action === 'none') {
    e.preventDefault();
    return;
  }

  // Calculate delta amount based on event
  // Some browsers use deltaX for shift+wheel, some keep deltaY but set shiftKey
  const isHorizontalScroll = e.deltaX !== 0 && Math.abs(e.deltaX) > Math.abs(e.deltaY);
  const delta = isHorizontalScroll ? e.deltaX : e.deltaY;
  if (!Number.isFinite(delta) || delta === 0) return;

  if (action === 'zoom') {
    e.preventDefault();
    // Use pan properties to implement zoom later if needed,
    // currently just center map as fallback
    // TODO: implement actual zoom
    return;
  }

  if (action === 'scroll_vertical') {
    e.preventDefault();
    panY.value -= delta;
    return;
  }

  if (action === 'scroll_horizontal') {
    e.preventDefault();
    panX.value -= delta;
    return;
  }
}

function togglePlayback() {
  if (isLoading.value) return;

  // If preview build failed, attempt a rebuild instead of permanently blocking playback controls.
  if (loadError.value) {
    loadError.value = null;
    scheduleBuild();
    return;
  }

  timelineStore.togglePlayback();
}

function setPlayback(params: { direction: 'forward' | 'backward'; speed: number }) {
  if (isLoading.value) return;
  if (!canInteractPlayback.value) return;

  const finalSpeed = params.direction === 'backward' ? -params.speed : params.speed;

  if (timelineStore.isPlaying && timelineStore.playbackSpeed === finalSpeed) {
    timelineStore.togglePlayback();
    blurActiveElement();
    return;
  }

  timelineStore.setPlaybackSpeed(finalSpeed);
  if (!timelineStore.isPlaying) {
    timelineStore.togglePlayback();
  }

  blurActiveElement();
}

function rewindToStart() {
  timelineStore.currentTime = 0;
  blurActiveElement();
}

function onPlaybackSpeedChange(v: any) {
  if (!v) return;
  const val = Number(v.value ?? v);
  const isPlaying = timelineStore.isPlaying;
  const currentSpeed = timelineStore.playbackSpeed;
  const direction = currentSpeed < 0 ? -1 : 1;
  timelineStore.setPlaybackSpeed(val * direction);
  if (!isPlaying) {
    // Only update speed state, don't start playback automatically when selecting speed
  }
}

function toggleMute() {
  timelineStore.toggleAudioMuted();
  blurActiveElement();
}

const isSavingStopFrame = ref(false);

function getCanvasFromContainer(): HTMLCanvasElement | null {
  const container = containerEl.value;
  if (!container) return null;
  const canvas = container.querySelector('canvas');
  return canvas instanceof HTMLCanvasElement ? canvas : null;
}

async function canvasToWebpBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return await new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Failed to create snapshot blob'));
          return;
        }
        resolve(blob);
      },
      'image/webp',
      quality,
    );
  });
}

async function createStopFrameSnapshot() {
  if (isSavingStopFrame.value) return;
  if (isLoading.value) return;
  if (loadError.value) return;

  const timelineName =
    projectStore.currentFileName ||
    projectStore.currentTimelinePath ||
    timelineStore.timelineDoc?.name ||
    'timeline';

  const fps = projectStore.projectSettings?.export?.fps ?? 30;
  const timeUs = uiCurrentTimeUs.value;

  const qualityPercent = workspaceStore.userSettings.stopFrames?.qualityPercent ?? 85;
  const quality = Math.max(0.01, Math.min(1, qualityPercent / 100));
  const extension = 'webp';
  const baseName = buildStopFrameBaseName({
    timelineName,
    timeUs,
    fps,
  });

  let filename = `${baseName}.${extension}`;
  let attempt = 0;
  // Try to find next available incremental suffix if file already exists.
  // Limits attempts to avoid infinite loop in case of unexpected errors.
  const MAX_ATTEMPTS = 10_000;
  while (attempt < MAX_ATTEMPTS) {
    const existingHandle = await projectStore.getProjectFileHandleByRelativePath({
      relativePath: `${SOURCES_DIR_NAME}/images/stop_frames/${filename}`,
      create: false,
    });
    if (!existingHandle) {
      break;
    }
    attempt += 1;
    const suffix = String(attempt).padStart(3, '0');
    filename = `${baseName}_${suffix}.${extension}`;
  }

  isSavingStopFrame.value = true;
  try {
    const exportWidth = Math.round(Number(projectStore.projectSettings?.export?.width ?? 0));
    const exportHeight = Math.round(Number(projectStore.projectSettings?.export?.height ?? 0));

    // Request export worker to render a high quality frame directly
    const { client } = getExportWorkerClient();
    setExportHostApi({
      getFileHandleByPath: async (path: string) => projectStore.getFileHandleByPath(path),
      onExportProgress: () => {},
    });

    const clipsPayload = JSON.parse(JSON.stringify(rawWorkerTimelineClips.value ?? workerTimelineClips.value));
    
    const blob = await client.extractFrameToBlob(
      timeUs,
      exportWidth,
      exportHeight,
      clipsPayload,
      quality,
    );

    if (!blob) {
      throw new Error('Worker returned empty blob');
    }

    const fileHandle = await projectStore.getProjectFileHandleByRelativePath({
      relativePath: `${SOURCES_DIR_NAME}/images/stop_frames/${filename}`,
      create: true,
    });

    if (!fileHandle) {
      toast.add({
        color: 'red',
        title: 'Snapshot failed',
        description: 'Could not access project folder for writing',
      });
      return;
    }

    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();

    toast.add({
      color: 'primary',
      title: 'Snapshot created',
      description: `Saved to ${SOURCES_DIR_NAME}/images/stop_frames/${filename}`,
    });
  } catch (err) {
    console.error('[Monitor] Failed to create stop frame snapshot', err);
    toast.add({
      color: 'red',
      title: 'Snapshot failed',
      description: err instanceof Error ? err.message : 'Unknown error',
    });
  } finally {
    isSavingStopFrame.value = false;
  }
}
</script>

<template>
  <div
    class="flex flex-col h-full bg-ui-bg-elevated border-r border-ui-border min-w-0 min-h-0"
    :class="{
      'outline-2 outline-primary-500/60 -outline-offset-2 z-10':
        focusStore.isPanelFocused('monitor'),
    }"
    @pointerdown="focusStore.setMainFocus('monitor')"
  >
    <!-- Header -->
    <div
      class="flex items-center justify-between px-2 py-1.5 border-b border-ui-border shrink-0 bg-ui-bg-elevated"
    >
      <span class="text-xs font-semibold text-ui-text-muted uppercase tracking-wider">
        {{ t('granVideoEditor.monitor.title', 'Monitor') }}
      </span>
      <div class="flex items-center gap-2 shrink-0">
        <UTooltip :text="t('granVideoEditor.monitor.snapshot', 'Create snapshot')">
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            icon="i-heroicons-camera"
            :loading="isSavingStopFrame"
            :disabled="isSavingStopFrame || isLoading || Boolean(loadError)"
            @click="createStopFrameSnapshot"
          />
        </UTooltip>

        <UTooltip :text="t('granVideoEditor.monitor.center', 'Center')">
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            icon="i-heroicons-arrows-pointing-in"
            @click="centerMonitor"
          />
        </UTooltip>

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

        <div class="w-28">
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
          >
            <template #leading="{ modelValue }">
              <UIcon
                v-if="(modelValue as any)?.isProject"
                name="i-heroicons-star-20-solid"
                class="w-3 h-3 text-primary-500 shrink-0"
                :title="t('granVideoEditor.monitor.projectResolutionHint')"
              />
            </template>
            <template #item-label="{ item }">
              <span :class="{ 'text-primary-500 font-medium': item.isProject }">
                {{ item.label }}
              </span>
            </template>
            <template #item-trailing="{ item }">
              <UIcon
                v-if="item.isProject"
                name="i-heroicons-star-20-solid"
                class="w-3.5 h-3.5 text-primary-500 shrink-0"
                :title="t('granVideoEditor.monitor.projectResolutionHint')"
              />
            </template>
          </USelectMenu>
        </div>
      </div>
    </div>

    <!-- Video area -->
    <div
      ref="viewportEl"
      class="flex-1 min-h-0 min-w-0 overflow-hidden relative"
      @pointerdown="onViewportPointerDown"
      @pointermove="onViewportPointerMove"
      @pointerup="stopPan"
      @pointercancel="stopPan"
    >
      <div class="absolute inset-0">
        <div class="absolute inset-0" :style="workspaceStyle">
          <div class="absolute inset-0 flex items-center justify-center">
            <div
              class="shrink-0 relative"
              :style="getCanvasWrapperStyle()"
              @pointerdown="onPreviewPointerDown"
            >
              <div ref="containerEl" :style="getCanvasInnerStyle()" />
              <svg
                class="absolute inset-0 overflow-visible"
                :width="renderWidth"
                :height="renderHeight"
                style="pointer-events: none"
              >
                <rect
                  v-if="isPreviewSelected"
                  x="0"
                  y="0"
                  :width="renderWidth"
                  :height="renderHeight"
                  fill="none"
                  :stroke="'var(--selection-ring)'"
                  stroke-width="2"
                />
              </svg>
            </div>
          </div>
        </div>

        <div
          v-if="videoItems.length === 0"
          class="absolute inset-0 flex flex-col items-center justify-center gap-3 text-ui-text-disabled"
        >
          <UIcon name="i-heroicons-play-circle" class="w-16 h-16" />
          <p class="text-sm">
            {{ t('granVideoEditor.monitor.empty', 'No clip selected') }}
          </p>
        </div>

        <div
          v-else-if="isLoading"
          class="absolute inset-0 flex items-center justify-center text-ui-text-muted"
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
      class="flex flex-wrap items-center justify-center gap-3 px-4 py-3.5 border-t border-ui-border shrink-0 bg-ui-bg-elevated"
    >
      <UButton
        size="md"
        variant="ghost"
        color="neutral"
        icon="i-heroicons-arrow-uturn-left"
        :aria-label="t('granVideoEditor.monitor.rewind', 'Rewind')"
        :disabled="!canInteractPlayback"
        @click="rewindToStart"
      />

      <UButton
        size="md"
        variant="ghost"
        color="neutral"
        icon="i-heroicons-backward"
        :aria-label="t('granVideoEditor.monitor.playBackward', 'Play backward')"
        :disabled="!canInteractPlayback"
        @click="
          setPlayback({ direction: 'backward', speed: selectedPlaybackSpeedOption?.value ?? 1 })
        "
      />

      <UButton
        size="md"
        variant="solid"
        color="primary"
        :icon="timelineStore.isPlaying ? 'i-heroicons-pause' : 'i-heroicons-play'"
        :aria-label="t('granVideoEditor.monitor.play', 'Play')"
        :disabled="!canInteractPlayback"
        @click="
          setPlayback({ direction: 'forward', speed: selectedPlaybackSpeedOption?.value ?? 1 })
        "
      />

      <div class="w-24">
        <USelectMenu
          :model-value="selectedPlaybackSpeedOption as any"
          :items="playbackSpeedOptions"
          value-key="value"
          label-key="label"
          size="sm"
          class="w-full"
          :disabled="!canInteractPlayback"
          @update:model-value="onPlaybackSpeedChange"
        />
      </div>

      <div class="flex items-center gap-2.5">
        <UButton
          size="sm"
          variant="ghost"
          color="neutral"
          :icon="audioMuted ? 'i-heroicons-speaker-x-mark' : 'i-heroicons-speaker-wave'"
          :aria-label="
            audioMuted
              ? t('granVideoEditor.monitor.audioUnmute', 'Unmute')
              : t('granVideoEditor.monitor.audioMute', 'Mute')
          "
          @click="toggleMute"
        />

        <WheelSlider
          :min="0"
          :max="1"
          :step="0.05"
          :model-value="audioMuted ? 0 : audioVolume"
          slider-class="w-20"
          :aria-label="t('granVideoEditor.monitor.audioVolume', 'Audio volume')"
          @update:model-value="(v) => timelineStore.setAudioVolume(Number(v ?? 1))"
        />

        <span class="text-sm text-ui-text-muted tabular-nums min-w-12">
          {{ Math.round((audioMuted ? 0 : audioVolume) * 100) }}%
        </span>
      </div>
      <span ref="timecodeEl" class="text-xs text-ui-text-muted ml-2 font-mono tabular-nums">
        00:00:00:00 / 00:00:00:00
      </span>
    </div>
  </div>
</template>
