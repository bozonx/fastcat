<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
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
import { useMonitorGestures } from '~/composables/monitor/useMonitorGestures';
import { useMonitorSnapshot } from '~/composables/monitor/useMonitorSnapshot';
import WheelSlider from '~/components/ui/WheelSlider.vue';
import MonitorAudioControl from './MonitorAudioControl.vue';

const { t } = useI18n();
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

const toolbarPosition = computed(() => projectStore.projectSettings.monitor?.toolbarPosition ?? 'bottom');

const contextMenuItems = computed(() => {
  return [
    [
      {
        label: t('granVideoEditor.monitor.center', 'Center'),
        icon: 'i-heroicons-arrows-pointing-in',
        onSelect: centerMonitor,
      },
      {
        label: t('granVideoEditor.monitor.toolbarTop', 'Панель сверху'),
        icon: toolbarPosition.value === 'top' ? 'i-heroicons-check' : undefined,
        onSelect: () => {
          if (projectStore.projectSettings.monitor) {
            projectStore.projectSettings.monitor.toolbarPosition = 'top';
          }
        },
      },
      {
        label: t('granVideoEditor.monitor.toolbarRight', 'Панель справа'),
        icon: toolbarPosition.value === 'right' ? 'i-heroicons-check' : undefined,
        onSelect: () => {
          if (projectStore.projectSettings.monitor) {
            projectStore.projectSettings.monitor.toolbarPosition = 'right';
          }
        },
      },
      {
        label: t('granVideoEditor.monitor.toolbarBottom', 'Панель снизу'),
        icon: toolbarPosition.value === 'bottom' ? 'i-heroicons-check' : undefined,
        onSelect: () => {
          if (projectStore.projectSettings.monitor) {
            projectStore.projectSettings.monitor.toolbarPosition = 'bottom';
          }
        },
      },
      {
        label: t('granVideoEditor.monitor.toolbarLeft', 'Панель слева'),
        icon: toolbarPosition.value === 'left' ? 'i-heroicons-check' : undefined,
        onSelect: () => {
          if (projectStore.projectSettings.monitor) {
            projectStore.projectSettings.monitor.toolbarPosition = 'left';
          }
        },
      },
    ],
  ];
});

defineProps<{
  isFullscreen?: boolean;
}>();
</script>

<template>
  <UContextMenu :items="contextMenuItems" class="h-full">
    <div
      class="flex h-full bg-ui-bg-elevated min-w-0 min-h-0"
      :class="[
        toolbarPosition === 'bottom' ? 'flex-col' : '',
        toolbarPosition === 'top' ? 'flex-col-reverse' : '',
        toolbarPosition === 'right' ? 'flex-row' : '',
        toolbarPosition === 'left' ? 'flex-row-reverse' : '',
        {
          'outline-2 outline-primary-500/60 -outline-offset-2 z-10':
            !isFullscreen && focusStore.isPanelFocused('monitor'),
          'border-r border-ui-border': !isFullscreen,
        },
      ]"
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

        <span
          ref="timecodeEl"
          class="absolute bottom-3 right-3 text-xs text-ui-text-muted font-mono tabular-nums bg-ui-bg-elevated/80 px-2 py-1 rounded"
        >
          00:00:00:00 / 00:00:00:00
        </span>
      </div>
    </div>

    <!-- Playback controls -->
    <div
      class="flex flex-wrap items-center justify-center gap-3 px-4 py-3.5 border-ui-border shrink-0 bg-ui-bg-elevated"
      :class="[
        toolbarPosition === 'bottom' ? 'border-t' : '',
        toolbarPosition === 'top' ? 'border-b' : '',
        toolbarPosition === 'right' ? 'border-l' : '',
        toolbarPosition === 'left' ? 'border-r' : '',
        toolbarPosition === 'left' || toolbarPosition === 'right' ? 'flex-col' : '',
      ]"
    >
      <div
        class="flex items-center gap-2 shrink-0"
        :class="toolbarPosition === 'left' || toolbarPosition === 'right' ? 'flex-col' : ''"
      >
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

        <div class="w-17">
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
            size="2xs"
            :search-input="false"
            :ui="{ trigger: 'px-1 py-1 font-medium', leading: { padding: { '2xs': 'ps-1' } } }"
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
              <span
                :class="[
                  item.value === projectStore.projectSettings.monitor?.previewResolution
                    ? 'text-primary-500 font-medium'
                    : '',
                  'truncate text-xs',
                ]"
              >
                {{ item.label }}
              </span>
            </template>
            <template #item-trailing="{ item }">
              <UIcon
                v-if="item.isProject"
                name="i-heroicons-star-20-solid"
                class="w-3 h-3 text-primary-500 shrink-0"
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
          @click="projectStore.goToCut()"
        />

        <UButton
          v-else
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-heroicons-arrows-pointing-out"
          :title="t('granVideoEditor.monitor.fullscreen', 'Fullscreen')"
          @click="projectStore.goToFullscreen()"
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

      <div class="w-15">
        <USelectMenu
          :model-value="selectedPlaybackSpeedOption as any"
          :items="playbackSpeedOptions"
          value-key="value"
          label-key="label"
          size="2xs"
          :ui="{ trigger: 'px-1 py-1 font-medium' }"
          class="w-full"
          :disabled="!canInteractPlayback"
          @update:model-value="onPlaybackSpeedChange"
        >
          <template #item-label="{ item }">
            <span class="truncate text-xs">{{ item.label }}</span>
          </template>
        </USelectMenu>
      </div>

      <MonitorAudioControl :compact="toolbarPosition === 'left' || toolbarPosition === 'right'" />
    </div>
    </div>
  </UContextMenu>
</template>
