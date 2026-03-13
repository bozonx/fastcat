<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProxyStore } from '~/stores/proxy.store';
import { useFocusStore } from '~/stores/focus.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useUiStore } from '~/stores/ui.store';
import { useMonitorTimeline } from '~/composables/monitor/useMonitorTimeline';
import { useMonitorDisplay } from '~/composables/monitor/useMonitorDisplay';
import { useMonitorPlayback } from '~/composables/monitor/useMonitorPlayback';
import { useMonitorCore } from '~/composables/monitor/useMonitorCore';
import { useMonitorGrid } from '~/composables/monitor/useMonitorGrid';
import { useMonitorSnapshot } from '~/composables/monitor/useMonitorSnapshot';
import MonitorAudioControl from './MonitorAudioControl.vue';
import MonitorTextTransformBox from './MonitorTextTransformBox.vue';
import MonitorViewport from './MonitorViewport.vue';
import MonitorTransformBox from './MonitorTransformBox.vue';

const { t } = useI18n();
const projectStore = useProjectStore();
const timelineStore = useTimelineStore();
const proxyStore = useProxyStore();
const focusStore = useFocusStore();
const workspaceStore = useWorkspaceStore();
const selectionStore = useSelectionStore();
const uiStore = useUiStore();
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

const selectedTimelineClip = computed(() => {
  const entity = selectionStore.selectedEntity;
  if (entity?.source !== 'timeline' || entity.kind !== 'clip') {
    return null;
  }

  return rawWorkerTimelineClips.value.find((clip) => clip.id === entity.itemId) ?? null;
});

const isTextClipSelected = computed(() => selectedTimelineClip.value?.clipType === 'text');

const { containerEl, renderWidth, renderHeight, updateCanvasDisplaySize } = useMonitorDisplay();

const viewportRef = ref<InstanceType<typeof MonitorViewport> | null>(null);

// Forward the MonitorViewport's inner viewportEl to useMonitorCore for ResizeObserver
const viewportEl = computed(() => (viewportRef.value?.viewportEl as HTMLDivElement | null) ?? null);

const {
  isLoading,
  loadError,
  previewEffectsEnabled,
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

const { showGrid, toggleGrid, getGridLines } = useMonitorGrid({ projectStore });

const monitorZoomLabel = computed(() => viewportRef.value?.zoomLabel ?? 'x1');

const isReadonly = computed(
  () => projectStore.currentView === 'sound' || projectStore.currentView === 'export',
);

function centerMonitor() {
  viewportRef.value?.centerMonitor();
}

function resetZoom() {
  viewportRef.value?.resetZoom();
}

function togglePreviewEffects() {
  if (!projectStore.projectSettings.monitor) {
    return;
  }

  projectStore.projectSettings.monitor.previewEffectsEnabled = !previewEffectsEnabled.value;
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
  timelineStore.setCurrentTimeUs(0);
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

function handleSpeedWheel(e: WheelEvent) {
  if (!canInteractPlayback.value) return;

  const currentAbs = Math.abs(timelineStore.playbackSpeed);
  const currentIndex = playbackSpeedOptions.findIndex((o) => o.value === currentAbs);
  const idx = currentIndex >= 0 ? currentIndex : 2;

  let nextIndex = idx;
  if (e.deltaY < 0) {
    nextIndex = Math.min(playbackSpeedOptions.length - 1, idx + 1);
  } else if (e.deltaY > 0) {
    nextIndex = Math.max(0, idx - 1);
  }

  if (nextIndex !== idx) {
    const nextSpeed = playbackSpeedOptions[nextIndex]?.value;
    if (!nextSpeed) return;
    const direction = timelineStore.playbackSpeed < 0 ? -1 : 1;
    timelineStore.setPlaybackSpeed(nextSpeed * direction);
  }
}

const { isSavingStopFrame, createStopFrameSnapshot, saveTimelineThumbnail } = useMonitorSnapshot({
  projectStore,
  timelineStore,
  workspaceStore,
  isLoading,
  loadError,
  uiCurrentTimeUs,
  workerTimelineClips,
  rawWorkerTimelineClips,
});

watch(
  () => uiStore.timelineSaveTrigger,
  () => {
    saveTimelineThumbnail();
  },
);

const toolbarPosition = computed(
  () => projectStore.projectSettings.monitor?.toolbarPosition ?? 'bottom',
);

function createMarkerAtPlayhead() {
  const existing = timelineStore.getMarkers();
  timelineStore.addMarkerAtPlayhead();
  const next = timelineStore.getMarkers();
  const created = next.find((m) => !existing.some((x) => x.id === m.id)) ?? next[next.length - 1];
  if (created) {
    selectionStore.selectTimelineMarker(created.id);
  }
}

const contextMenuItems = computed(() => {
  return [
    [
      {
        label: t('fastcat.preview.resetZoom', 'Reset Zoom & Pan'),
        icon: 'i-heroicons-arrow-path',
        onSelect: () => viewportRef.value?.resetView(),
      },
      {
        label: showGrid.value
          ? t('fastcat.monitor.hideGrid', 'Hide grid')
          : t('fastcat.monitor.showGrid', 'Show grid'),
        icon: showGrid.value ? 'i-heroicons-check' : 'i-heroicons-squares-2x2',
        onSelect: toggleGrid,
      },
      {
        label: t('fastcat.monitor.snapshot', 'Create snapshot'),
        icon: 'i-heroicons-camera',
        onSelect: createStopFrameSnapshot,
        disabled: isSavingStopFrame.value || isLoading.value || Boolean(loadError.value),
      },
    ],
    [
      {
        label: t('fastcat.monitor.toolbarTop', 'Панель сверху'),
        icon: toolbarPosition.value === 'top' ? 'i-heroicons-check' : undefined,
        onSelect: () => {
          if (projectStore.projectSettings.monitor) {
            projectStore.projectSettings.monitor.toolbarPosition = 'top';
          }
        },
      },
      {
        label: t('fastcat.monitor.toolbarRight', 'Панель справа'),
        icon: toolbarPosition.value === 'right' ? 'i-heroicons-check' : undefined,
        onSelect: () => {
          if (projectStore.projectSettings.monitor) {
            projectStore.projectSettings.monitor.toolbarPosition = 'right';
          }
        },
      },
      {
        label: t('fastcat.monitor.toolbarBottom', 'Панель снизу'),
        icon: toolbarPosition.value === 'bottom' ? 'i-heroicons-check' : undefined,
        onSelect: () => {
          if (projectStore.projectSettings.monitor) {
            projectStore.projectSettings.monitor.toolbarPosition = 'bottom';
          }
        },
      },
      {
        label: t('fastcat.monitor.toolbarLeft', 'Панель слева'),
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

const props = withDefaults(
  defineProps<{
    isFullscreen?: boolean;
  }>(),
  {
    isFullscreen: false,
  },
);

const emit = defineEmits<{
  panelDragStart: [e: DragEvent];
}>();
</script>

<template>
  <UContextMenu :items="contextMenuItems" class="h-full group/monitor">
    <div
      class="flex h-full min-w-0 min-h-0 transition-colors duration-300 relative"
      :class="[
        isFullscreen ? 'bg-black flex-col' : 'bg-ui-bg-elevated',
        !isFullscreen && toolbarPosition === 'bottom' ? 'flex-col' : '',
        !isFullscreen && toolbarPosition === 'top' ? 'flex-col-reverse' : '',
        !isFullscreen && toolbarPosition === 'right' ? 'flex-row' : '',
        !isFullscreen && toolbarPosition === 'left' ? 'flex-row-reverse' : '',
        {
          'outline-2 outline-primary-500/60 -outline-offset-2 z-10':
            !isFullscreen && focusStore.isPanelFocused('monitor'),
          'border-r border-ui-border': !isFullscreen,
        },
      ]"
      @pointerdown.capture="focusStore.setMainFocus('monitor')"
    >
      <!-- Video area: MonitorViewport handles pan/zoom/gestures -->
      <MonitorViewport ref="viewportRef" :render-width="renderWidth" :render-height="renderHeight">
        <!-- WebGL/canvas container mounted at canvas resolution -->
        <template #canvas>
          <div ref="containerEl" class="absolute inset-0" style="pointer-events: none" />
        </template>

        <!-- 3x3 guide grid SVG overlay, synced with viewport transform -->
        <template #svg-overlay>
          <g v-if="showGrid">
            <line
              v-for="(line, i) in getGridLines(renderWidth, renderHeight)"
              :key="i"
              :x1="line.x1"
              :y1="line.y1"
              :x2="line.x2"
              :y2="line.y2"
              stroke="rgba(255,255,255,0.5)"
              stroke-width="1"
            />
          </g>

          <MonitorTextTransformBox
            v-if="!isReadonly && isTextClipSelected"
            :render-width="renderWidth"
            :render-height="renderHeight"
          />

          <MonitorTransformBox
            v-else-if="!isReadonly"
            :render-width="renderWidth"
            :render-height="renderHeight"
          />
        </template>

        <!-- Absolute overlays: empty state, loading, error, timecode -->
        <template #default>
          <div
            v-if="loadError"
            class="absolute inset-0 flex items-center justify-center text-red-500"
          >
            {{ loadError }}
          </div>

          <span
            ref="timecodeEl"
            class="absolute text-xs text-ui-text-muted font-mono tabular-nums bg-ui-bg-elevated/80 px-2 py-1 rounded transition-all duration-300"
            :class="[
              isFullscreen
                ? 'bottom-24 right-8 opacity-0 group-hover/monitor:opacity-100 translate-y-2 group-hover/monitor:translate-y-0'
                : 'bottom-3 right-3',
            ]"
          >
            00:00:00:00 / 00:00:00:00
          </span>
        </template>
      </MonitorViewport>

      <!-- Playback controls -->
      <div
        class="flex flex-wrap items-center justify-center gap-3 border-ui-border shrink-0 transition-all duration-300 select-none"
        :class="[
          isFullscreen
            ? 'absolute bottom-8 left-1/2 -translate-x-1/2 bg-ui-bg-elevated/80 backdrop-blur-xl px-6 py-3 rounded-2xl shadow-2xl z-50 border-none opacity-0 group-hover/monitor:opacity-100 hover:!opacity-100 translate-y-4 group-hover/monitor:translate-y-0'
            : 'px-4 py-3.5 bg-ui-bg-elevated cursor-grab active:cursor-grabbing',
          !isFullscreen && toolbarPosition === 'bottom' ? 'border-t' : '',
          !isFullscreen && toolbarPosition === 'top' ? 'border-b' : '',
          !isFullscreen && toolbarPosition === 'right' ? 'border-l' : '',
          !isFullscreen && toolbarPosition === 'left' ? 'border-r' : '',
          (toolbarPosition === 'left' || toolbarPosition === 'right') && !isFullscreen
            ? 'flex-col'
            : '',
        ]"
        :draggable="!isFullscreen"
        @dragstart="(e) => emit('panelDragStart', e)"
      >
        <div
          class="flex items-center gap-2 shrink-0"
          :class="toolbarPosition === 'left' || toolbarPosition === 'right' ? 'flex-col' : ''"
        >
          <UTooltip
            :text="t('fastcat.timeline.addMarkerAtPlayhead', 'Add marker at playhead')"
          >
            <UButton
              size="2xs"
              color="neutral"
              variant="ghost"
              icon="i-heroicons-bookmark"
              @click="createMarkerAtPlayhead"
            />
          </UTooltip>

          <UTooltip :text="t('fastcat.monitor.center', 'Center')">
            <UButton
              size="2xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-crosshair"
              @click="centerMonitor"
            />
          </UTooltip>

          <UTooltip :text="t('fastcat.monitor.resetZoom', 'Reset zoom')">
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              class="font-mono tabular-nums min-w-12 justify-center"
              :label="monitorZoomLabel"
              @click="resetZoom"
            />
          </UTooltip>

          <UTooltip :text="t('fastcat.monitor.useProxy', 'Use proxy')">
            <UButton
              v-if="projectStore.projectSettings.monitor"
              size="xs"
              :color="useProxyInMonitor ? 'primary' : 'neutral'"
              :variant="useProxyInMonitor ? 'soft' : 'ghost'"
              icon="i-heroicons-bolt"
              @click="projectStore.projectSettings.monitor.useProxy = !useProxyInMonitor"
            />
          </UTooltip>

          <UTooltip
            :text="
              previewEffectsEnabled
                ? t('fastcat.monitor.previewWithEffects', 'Preview with effects')
                : t('fastcat.monitor.previewWithoutEffects', 'Preview without effects')
            "
          >
            <UButton
              v-if="projectStore.projectSettings.monitor"
              size="xs"
              :color="previewEffectsEnabled ? 'primary' : 'neutral'"
              :variant="previewEffectsEnabled ? 'soft' : 'ghost'"
              :label="
                previewEffectsEnabled
                  ? t('fastcat.monitor.withEffects', 'With effects')
                  : t('fastcat.monitor.withoutEffects', 'Without effects')
              "
              @click="togglePreviewEffects"
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
              :ui="{ trigger: 'px-1 py-1 font-medium' }"
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
                  :title="t('fastcat.monitor.projectResolutionHint')"
                />
                <span v-else class="w-3 h-3 shrink-0"></span>
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
                  v-if="
                    item.isProject &&
                    item.value !== projectStore.projectSettings.monitor?.previewResolution
                  "
                  name="i-heroicons-star-20-solid"
                  class="w-3 h-3 text-primary-500 shrink-0"
                  :title="t('fastcat.monitor.projectResolutionHint')"
                />
              </template>
            </USelectMenu>
          </div>

          <UButton
            v-if="isFullscreen"
            size="sm"
            color="primary"
            variant="solid"
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
            :title="t('fastcat.monitor.fullscreen', 'Fullscreen')"
            @click="projectStore.goToFullscreen()"
          />
        </div>

        <UButton
          size="md"
          variant="ghost"
          color="neutral"
          icon="i-heroicons-arrow-uturn-left"
          :aria-label="t('fastcat.monitor.rewind', 'Rewind')"
          :disabled="!canInteractPlayback"
          @click="rewindToStart"
        />

        <UButton
          size="md"
          variant="ghost"
          color="neutral"
          icon="i-heroicons-backward"
          :aria-label="t('fastcat.monitor.playBackward', 'Play backward')"
          :disabled="!canInteractPlayback"
          @click="
            setPlayback({ direction: 'backward', speed: selectedPlaybackSpeedOption?.value ?? 1 })
          "
          @wheel.prevent="handleSpeedWheel"
        />

        <UButton
          size="md"
          variant="solid"
          color="primary"
          :icon="timelineStore.isPlaying ? 'i-heroicons-pause' : 'i-heroicons-play'"
          :aria-label="t('fastcat.monitor.play', 'Play')"
          :disabled="!canInteractPlayback"
          @click="
            setPlayback({ direction: 'forward', speed: selectedPlaybackSpeedOption?.value ?? 1 })
          "
          @wheel.prevent="handleSpeedWheel"
        />

        <div class="w-15">
          <USelectMenu
            :model-value="selectedPlaybackSpeedOption as any"
            :items="playbackSpeedOptions"
            value-key="value"
            label-key="label"
            size="2xs"
            :search-input="false"
            :ui="{ trigger: 'px-1 py-1 font-medium' }"
            class="w-full"
            :disabled="!canInteractPlayback"
            @update:model-value="onPlaybackSpeedChange"
            @wheel.prevent="handleSpeedWheel"
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
