<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProxyStore } from '~/stores/proxy.store';
import { useFocusStore } from '~/stores/focus.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useEditorViewStore } from '~/stores/editorView.store';
import { useMonitorTimeline } from '~/composables/monitor/useMonitorTimeline';
import { useMonitorDisplay } from '~/composables/monitor/useMonitorDisplay';
import { useMonitorPlayback } from '~/composables/monitor/useMonitorPlayback';
import { useMonitorCore } from '~/composables/monitor/useMonitorCore';
import { useMonitorGestures } from '~/composables/monitor/useMonitorGestures';
import { useMonitorSnapshot } from '~/composables/monitor/useMonitorSnapshot';
import WheelSlider from '~/components/ui/WheelSlider.vue';

const { t } = useI18n();
const projectStore = useProjectStore();
const timelineStore = useTimelineStore();
const proxyStore = useProxyStore();
const focusStore = useFocusStore();
const workspaceStore = useWorkspaceStore();
const viewStore = useEditorViewStore();
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
  const projectHeight = projectStore.projectSettings.project.height;
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

const {
  isPreviewSelected,
  workspaceStyle,
  centerMonitor,
  onPreviewPointerDown,
  onViewportPointerDown,
  onViewportPointerMove,
  stopPan,
  onViewportWheel,
} = useMonitorGestures({ projectStore });

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


const { isSavingStopFrame, createStopFrameSnapshot } = useMonitorSnapshot({
  projectStore,
  timelineStore,
  workspaceStore,
  isLoading,
  loadError,
  uiCurrentTimeUs,
  workerTimelineClips,
  rawWorkerTimelineClips,
});

defineProps<{
  isFullscreen?: boolean;
}>();
</script>

<template>
  <div
    class="flex flex-col h-full bg-ui-bg-elevated min-w-0 min-h-0"
    :class="{
      'outline-2 outline-primary-500/60 -outline-offset-2 z-10':
        !isFullscreen && focusStore.isPanelFocused('monitor'),
      'border-r border-ui-border': !isFullscreen,
    }"
    @pointerdown.capture="focusStore.setMainFocus('monitor')"
  >


    <!-- Video area -->
    <div
      ref="viewportEl"
      class="flex-1 min-h-0 min-w-0 overflow-hidden relative"
      @pointerdown="onViewportPointerDown"
      @pointermove="onViewportPointerMove"
      @pointerup="stopPan"
      @pointercancel="stopPan"
      @wheel="onViewportWheel"
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

        <UButton
          v-if="isFullscreen"
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-heroicons-arrow-left"
          :label="t('common.back', 'Back')"
          @click="viewStore.goToCut()"
        />

        <UButton
          v-else
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-heroicons-arrows-pointing-out"
          :title="t('granVideoEditor.monitor.fullscreen', 'Fullscreen')"
          @click="viewStore.goToFullscreen()"
        />
      </div>

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
          :max="2"
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
