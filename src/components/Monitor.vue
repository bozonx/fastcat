<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProxyStore } from '~/stores/proxy.store';
import { useFocusStore } from '~/stores/focus.store';
import { useMonitorTimeline } from '~/composables/monitor/useMonitorTimeline';
import { useMonitorDisplay } from '~/composables/monitor/useMonitorDisplay';
import { useMonitorPlayback } from '~/composables/monitor/useMonitorPlayback';
import { useMonitorCore } from '~/composables/monitor/useMonitorCore';

const { t } = useI18n();
const projectStore = useProjectStore();
const timelineStore = useTimelineStore();
const proxyStore = useProxyStore();
const focusStore = useFocusStore();
const { isPlaying, currentTime, duration, audioVolume, audioMuted } = storeToRefs(timelineStore);

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
  if (event.button !== 1) return;
  isPanning.value = true;
  panStart.value = { x: event.clientX, y: event.clientY };
  panOrigin.value = { x: panX.value, y: panY.value };
  (event.currentTarget as HTMLElement | null)?.setPointerCapture(event.pointerId);
  event.preventDefault();
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

function formatTime(seconds: number): string {
  if (isNaN(seconds)) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
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

function onVolumeInput(event: Event) {
  const target = event.target as HTMLInputElement | null;
  timelineStore.setAudioVolume(Number(target?.value ?? 1));
}

function toggleMute() {
  timelineStore.toggleAudioMuted();
}
</script>

<template>
  <div
    class="flex flex-col h-full bg-ui-bg-elevated border-r border-ui-border min-w-0 min-h-0"
    :class="{ 'outline-2 outline-primary-500/60 -outline-offset-2 z-10': focusStore.isPanelFocused('monitor') }"
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
                  stroke="#60a5fa"
                  stroke-width="2"
                />
              </svg>
            </div>
          </div>
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
      class="flex flex-wrap items-center justify-center gap-3 px-4 py-3.5 border-t border-ui-border shrink-0 bg-ui-bg-elevated"
    >
      <UButton
        size="md"
        variant="ghost"
        color="neutral"
        icon="i-heroicons-backward"
        :aria-label="t('granVideoEditor.monitor.rewind', 'Rewind')"
        :disabled="!canInteractPlayback"
        @click="timelineStore.currentTime = 0"
      />
      <UButton
        size="md"
        variant="solid"
        color="primary"
        :icon="timelineStore.isPlaying ? 'i-heroicons-pause' : 'i-heroicons-play'"
        :aria-label="t('granVideoEditor.monitor.play', 'Play')"
        :disabled="!canInteractPlayback"
        @click="togglePlayback"
      />
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
        <USlider
          :min="0"
          :max="1"
          :step="0.05"
          :model-value="audioMuted ? 0 : audioVolume"
          class="w-28"
          :aria-label="t('granVideoEditor.monitor.audioVolume', 'Audio volume')"
          @update:model-value="(v) => timelineStore.setAudioVolume(Number(v ?? 1))"
        />
        <span class="text-sm text-ui-text-muted tabular-nums min-w-12">
          {{ Math.round((audioMuted ? 0 : audioVolume) * 100) }}%
        </span>
      </div>
      <span ref="timecodeEl" class="text-sm text-ui-text-muted ml-2 font-mono">
        {{ formatTime(uiCurrentTimeUs / 1e6) }} / {{ formatTime(timelineStore.duration / 1e6) }}
      </span>
    </div>
  </div>
</template>
