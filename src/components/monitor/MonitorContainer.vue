<script setup lang="ts">
import UiTooltip from '~/components/ui/UiTooltip.vue';
import UiContextMenuPortal from '~/components/ui/UiContextMenuPortal.vue';
import { computed, nextTick, ref, watch } from 'vue';
import { useFullscreen } from '@vueuse/core';
import { useFocusStore } from '~/stores/focus.store';
import { useMonitorContainerControls } from '~/composables/monitor/useMonitorContainerControls';
import { useMonitorGrid } from '~/composables/monitor/useMonitorGrid';
import { useMonitorRuntime } from '~/composables/monitor/useMonitorRuntime';
import MonitorAudioControl from './MonitorAudioControl.vue';
import MonitorTextTransformBox from './MonitorTextTransformBox.vue';
import MonitorViewport from './MonitorViewport.vue';
import MonitorTransformBox from './MonitorTransformBox.vue';

const { t } = useI18n();
const focusStore = useFocusStore();

const panelRef = ref<HTMLElement | null>(null);
const {
  isFullscreen: isBrowserFullscreen,
  enter: enterBrowserFullscreen,
  exit: exitBrowserFullscreen,
} = useFullscreen(panelRef);

const {
  projectStore,
  timelineStore,
  selectionStore,
  videoItems,
  safeDurationUs,
  isTextClipSelected,
  containerEl,
  renderWidth,
  renderHeight,
  viewportRef,
  isLoading,
  loadError,
  previewEffectsEnabled,
  scheduleBuild,
  useProxyInMonitor,
  isSavingStopFrame,
  createStopFrameSnapshot,
  timecodeEl,
} = useMonitorRuntime();

const effectiveFullscreen = computed(() => props.isFullscreen || isBrowserFullscreen.value);

function restoreViewAfterFullscreen() {
  if (projectStore.lastViewBeforeFullscreen) {
    projectStore.setView(projectStore.lastViewBeforeFullscreen);
    return;
  }

  projectStore.goToCut();
}

// Sync internal fullscreen state with browser fullscreen
watch(isBrowserFullscreen, (val) => {
  if (val) {
    projectStore.goToFullscreen();
    focusStore.setMainFocus('monitor');
  } else if (projectStore.currentView === 'fullscreen') {
    restoreViewAfterFullscreen();
  }
  // Re-fit monitor after viewport size changes on fullscreen toggle
  void nextTick(() => {
    (viewportRef.value as any)?.fitMonitor?.();
  });
});

watch(
  () => projectStore.currentView,
  (view) => {
    if ((view as any) === 'fullscreen' && !isBrowserFullscreen.value) {
      void enterBrowserFullscreen();
    } else if ((view as any) !== 'fullscreen' && isBrowserFullscreen.value) {
      void exitBrowserFullscreen();
    }
  },
);

const { showGrid, toggleGrid, getGridLines } = useMonitorGrid({ projectStore });

const {
  canInteractPlayback,
  centerMonitor,
  contextMenuItems,
  createMarkerAtPlayhead,
  handleSpeedWheel,
  onPlaybackSpeedChange,
  playbackSpeedOptions,
  previewResolutions,
  resetZoom,
  rewindToStart,
  selectedPlaybackSpeedOption,
  setPlayback,
  togglePlayback,
  togglePreviewEffects,
  toggleProxyUsage,
  toolbarPosition,
} = useMonitorContainerControls({
  t,
  projectStore,
  timelineStore,
  selectionStore,
  viewportRef,
  videoItems,
  isLoading,
  loadError,
  safeDurationUs,
  previewEffectsEnabled,
  useProxyInMonitor,
  showGrid,
  isSavingStopFrame,
  createStopFrameSnapshot,
  scheduleBuild,
  toggleGrid,
});

const isReadonly = computed(
  () => projectStore.currentView === 'sound' || projectStore.currentView === 'export',
);

const selectedPreviewResolution = computed(() => {
  const currentValue = Number(projectStore.activeMonitor?.previewResolution);
  if (!Number.isFinite(currentValue) || currentValue <= 0) {
    return null;
  }

  const normalizedCurrentValue = Math.round(currentValue);

  return (
    previewResolutions.value.find((resolution) => resolution.value === normalizedCurrentValue) ?? {
      label: `${normalizedCurrentValue}p`,
      value: normalizedCurrentValue,
      isProject: normalizedCurrentValue === projectStore.projectSettings.project.height,
    }
  );
});

const speedMenuItems = computed(() => [
  playbackSpeedOptions.map((opt) => ({
    label: opt.label,
    onSelect: () => onPlaybackSpeedChange(opt),
    icon:
      selectedPlaybackSpeedOption.value?.value === opt.value
        ? 'i-heroicons-check-20-solid'
        : undefined,
  })),
]);

const monitorZoomLabel = computed(() => (viewportRef.value as any)?.zoomLabel ?? 'x1');

const props = withDefaults(
  defineProps<{
    isFullscreen?: boolean;
    useExternalFocus?: boolean;
    panelDragCursorClass?: string;
  }>(),
  {
    isFullscreen: false,
    useExternalFocus: false,
    panelDragCursorClass: 'cursor-grab active:cursor-grabbing',
  },
);

const isIdle = ref(false);
let idleTimer: number | undefined;

function resetIdle() {
  isIdle.value = false;
  if (idleTimer) window.clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => {
    isIdle.value = true;
  }, 2000);
}

function onGlobalMouseMove() {
  resetIdle();
}

onMounted(() => {
  window.addEventListener('mousemove', onGlobalMouseMove);
});

onUnmounted(() => {
  window.removeEventListener('mousemove', onGlobalMouseMove);
  if (idleTimer) window.clearTimeout(idleTimer);
});

const emit = defineEmits<{
  panelDragStart: [e: DragEvent];
}>();
</script>

<template>
  <div class="h-full">
    <!-- Portal context menu rendered inside panelRef — works in browser fullscreen -->
    <UiContextMenuPortal :items="contextMenuItems" :target-el="panelRef" />

    <UContextMenu
      :items="contextMenuItems"
      :modal="false"
      class="h-full group/monitor"
      :ui="{ content: 'z-[100000]' }"
    >
      <div
        ref="panelRef"
        class="panel-focus-frame flex h-full min-w-0 min-h-0 transition-colors duration-300 relative"
        :class="[
          effectiveFullscreen ? 'bg-black flex-col' : 'bg-ui-bg-elevated',
          !effectiveFullscreen && toolbarPosition === 'bottom' ? 'flex-col' : '',
          !effectiveFullscreen && toolbarPosition === 'top' ? 'flex-col-reverse' : '',
          !effectiveFullscreen && toolbarPosition === 'right' ? 'flex-row' : '',
          !effectiveFullscreen && toolbarPosition === 'left' ? 'flex-row-reverse' : '',
          {
            'panel-focus-frame--active':
              !props.useExternalFocus &&
              !effectiveFullscreen &&
              focusStore.isPanelFocused('monitor'),
            'border-r border-ui-border': !effectiveFullscreen,
          },
        ]"
        @pointerdown.capture="!props.useExternalFocus && focusStore.setMainFocus('monitor')"
      >
        <!-- Video area: MonitorViewport handles pan/zoom/gestures -->
        <MonitorViewport
          ref="viewportRef"
          :render-width="renderWidth"
          :render-height="renderHeight"
        >
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
                effectiveFullscreen ? 'bottom-24 right-8 translate-y-2' : 'bottom-3 right-3',
                effectiveFullscreen && isIdle ? 'opacity-0' : 'opacity-100 translate-y-0',
              ]"
            >
              00:00:00:00 / 00:00:00:00
            </span>
          </template>
        </MonitorViewport>

        <!-- Playback controls -->
        <!-- Playback controls -->
        <div
          class="flex flex-wrap items-center justify-center gap-3 border-ui-border shrink-0 transition-all duration-300 select-none"
          :class="[
            effectiveFullscreen
              ? 'absolute bottom-8 left-1/2 -translate-x-1/2 bg-ui-bg-elevated/80 backdrop-blur-xl px-6 py-3 rounded-2xl shadow-2xl z-50 border-none translate-y-4'
              : ['px-4 py-3.5 bg-ui-bg-elevated', props.panelDragCursorClass],
            effectiveFullscreen && isIdle ? 'opacity-0' : 'opacity-100 translate-y-0',
            !effectiveFullscreen && toolbarPosition === 'bottom' ? 'border-t' : '',
            !effectiveFullscreen && toolbarPosition === 'top' ? 'border-b' : '',
            !effectiveFullscreen && toolbarPosition === 'right' ? 'border-l' : '',
            !effectiveFullscreen && toolbarPosition === 'left' ? 'border-r' : '',
            (toolbarPosition === 'left' || toolbarPosition === 'right') && !effectiveFullscreen
              ? 'flex-col'
              : '',
          ]"
          :draggable="!effectiveFullscreen"
          @dragstart="(e) => emit('panelDragStart', e)"
          @mouseenter="resetIdle"
        >
          <div
            class="flex items-center gap-2 shrink-0"
            :class="toolbarPosition === 'left' || toolbarPosition === 'right' ? 'flex-col' : ''"
          >
            <UiTooltip :text="t('fastcat.timeline.addMarkerAtPlayhead', 'Add marker at playhead')">
              <UButton
                size="2xs"
                color="neutral"
                variant="ghost"
                icon="i-heroicons-bookmark"
                @click="createMarkerAtPlayhead"
              />
            </UiTooltip>

            <UiTooltip :text="t('fastcat.monitor.center', 'Center')">
              <UButton
                size="2xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-crosshair"
                @click="centerMonitor"
              />
            </UiTooltip>

            <UiTooltip :text="t('fastcat.monitor.resetZoom', 'Reset zoom')">
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                class="font-mono tabular-nums min-w-12 justify-center"
                :label="monitorZoomLabel"
                @click="resetZoom"
              />
            </UiTooltip>

            <UiTooltip :text="t('fastcat.monitor.useProxy', 'Use proxy')">
              <UButton
                v-if="projectStore.activeMonitor"
                size="xs"
                color="neutral"
                :variant="useProxyInMonitor ? 'soft' : 'ghost'"
                icon="i-heroicons-bolt"
                :class="
                  useProxyInMonitor
                    ? 'text-(--selection-accent-400) ring-(--selection-accent-500)/40 bg-[rgba(59,130,246,0.12)]'
                    : ''
                "
                @click="toggleProxyUsage"
              />
            </UiTooltip>

            <UiTooltip
              :text="
                previewEffectsEnabled
                  ? t('fastcat.monitor.previewWithEffects', 'Preview with effects')
                  : t('fastcat.monitor.previewWithoutEffects', 'Preview without effects')
              "
            >
              <UButton
                v-if="projectStore.activeMonitor"
                size="xs"
                color="neutral"
                :variant="previewEffectsEnabled ? 'soft' : 'ghost'"
                icon="i-heroicons-sparkles"
                :class="
                  previewEffectsEnabled
                    ? 'text-(--selection-accent-400) ring-(--selection-accent-500)/40 bg-[rgba(59,130,246,0.12)]'
                    : ''
                "
                @click="togglePreviewEffects"
              />
            </UiTooltip>

            <div class="w-auto min-w-14">
              <USelectMenu
                v-if="projectStore.activeMonitor"
                :model-value="selectedPreviewResolution as any"
                :items="previewResolutions"
                value-key="value"
                label-key="label"
                :search-input="false"
                class="w-full"
                @update:model-value="
                  (v: any) => {
                    if (v && projectStore.activeMonitor)
                      projectStore.activeMonitor.previewResolution = v.value ?? v;
                  }
                "
              >
                <template #default="{ modelValue }">
                  <span class="truncate text-[11px] leading-none font-medium">
                    {{ (modelValue as any)?.label }}
                  </span>
                </template>
                <template #item-label="{ item }">
                  <span
                    :class="[
                      item.value === projectStore.activeMonitor?.previewResolution
                        ? 'text-ui-text font-medium'
                        : '',
                      'truncate',
                    ]"
                  >
                    {{ item.label }}{{ item.isProject ? ' *' : '' }}
                  </span>
                </template>
              </USelectMenu>
            </div>

            <UButton
              v-if="effectiveFullscreen"
              size="sm"
              color="neutral"
              variant="solid"
              icon="i-heroicons-arrow-left"
              :label="t('common.back', 'Back')"
              @click="exitBrowserFullscreen()"
            />

            <UButton
              v-else
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-heroicons-arrows-pointing-out"
              :title="t('fastcat.monitor.fullscreen', 'Fullscreen')"
              @click="enterBrowserFullscreen()"
            />
          </div>

          <UContextMenu :items="speedMenuItems">
            <UButton
              size="md"
              variant="ghost"
              color="neutral"
              icon="i-heroicons-arrow-uturn-left"
              :aria-label="t('fastcat.monitor.rewind', 'Rewind')"
              :disabled="!canInteractPlayback"
              @click="rewindToStart"
            />
          </UContextMenu>

          <UContextMenu :items="speedMenuItems">
            <UButton
              size="md"
              variant="ghost"
              color="neutral"
              icon="i-heroicons-backward"
              :aria-label="t('fastcat.monitor.playBackward', 'Play backward')"
              :disabled="!canInteractPlayback"
              @click="
                setPlayback({
                  direction: 'backward',
                  speed: selectedPlaybackSpeedOption?.value ?? 1,
                })
              "
              @wheel.prevent="handleSpeedWheel"
            />
          </UContextMenu>

          <UContextMenu :items="speedMenuItems">
            <UButton
              size="md"
              variant="solid"
              color="neutral"
              class="relative overflow-hidden min-w-8 px-1.5"
              :aria-label="t('fastcat.monitor.play', 'Play')"
              :disabled="!canInteractPlayback"
              @click="
                setPlayback({
                  direction: 'forward',
                  speed: selectedPlaybackSpeedOption?.value ?? 1,
                })
              "
              @wheel.prevent="handleSpeedWheel"
            >
              <div class="flex items-center justify-center">
                <UIcon
                  :name="
                    timelineStore.isPlaying
                      ? 'i-heroicons-stop-20-solid'
                      : 'i-heroicons-play-20-solid'
                  "
                  class="w-5 h-5"
                  :class="!timelineStore.isPlaying ? 'ml-0.5' : ''"
                />
                <span
                  class="absolute text-[8px] font-mono leading-none opacity-90 pointer-events-none"
                  style="right: 4px; bottom: 0"
                >
                  {{ selectedPlaybackSpeedOption?.label }}
                </span>
              </div>
            </UButton>
          </UContextMenu>

          <MonitorAudioControl
            :compact="toolbarPosition === 'left' || toolbarPosition === 'right'"
          />

          <UDropdownMenu :items="contextMenuItems">
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-heroicons-ellipsis-horizontal"
              :title="t('common.more', 'More')"
            />
          </UDropdownMenu>
        </div>
      </div>
    </UContextMenu>
  </div>
</template>
