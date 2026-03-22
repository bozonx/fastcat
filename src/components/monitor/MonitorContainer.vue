<script setup lang="ts">
import UiTooltip from '~/components/ui/UiTooltip.vue';
import UiContextMenuPortal from '~/components/ui/UiContextMenuPortal.vue';
import UiSelect from '~/components/ui/UiSelect.vue';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useFullscreen } from '@vueuse/core';
import { useFocusStore } from '~/stores/focus.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useMonitorContainerControls } from '~/composables/monitor/useMonitorContainerControls';
import { useMonitorGrid } from '~/composables/monitor/useMonitorGrid';
import { useMonitorRuntime } from '~/composables/monitor/useMonitorRuntime';
import { TIMELINES_DIR_NAME } from '~/utils/constants';
import { serializeTimelineToOtio } from '~/timeline/otioSerializer';
import MonitorAudioControl from './MonitorAudioControl.vue';
import MonitorTextTransformBox from './MonitorTextTransformBox.vue';
import MonitorViewport from './MonitorViewport.vue';
import MonitorTransformBox from './MonitorTransformBox.vue';
import { registerMonitorActions } from '~/composables/editor/hotkeys/monitorActions';
import { useFileManager } from '~/composables/fileManager/useFileManager';
import { useProjectActions } from '~/composables/editor/useProjectActions';

const { t } = useI18n();
const toast = useToast();
const focusStore = useFocusStore();
const projectStore = useProjectStore();
const timelineStore = useTimelineStore();
const fileManager = useFileManager();
const { loadTimeline } = useProjectActions();

async function createNewTimeline() {
  const createdPath = await fileManager.createTimeline();
  if (createdPath) {
    await loadTimeline(createdPath);
    toast.add({
      color: 'success',
      title: t('timelineCreation.successTitle', 'Timeline created'),
      description: createdPath,
    });
  }
}

// panelRef is stable — never conditionally rendered, so useFullscreen always holds a valid target
const panelRef = ref<HTMLElement | null>(null);
const {
  isFullscreen: isBrowserFullscreen,
  enter: enterBrowserFullscreen,
  exit: exitBrowserFullscreen,
} = useFullscreen(panelRef);

const {
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

registerMonitorActions({
  createStopFrameSnapshot,
  createNewTimeline,
});

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

const emit = defineEmits<{
  panelDragStart: [e: DragEvent];
}>();

const effectiveFullscreen = computed(() => props.isFullscreen || isBrowserFullscreen.value);

// Saved panel zoom/pan before entering fullscreen so we can restore it on exit
const savedPanelViewport = ref<{ zoom: number; panX: number; panY: number } | null>(null);

function capturePanelViewport() {
  const m = projectStore.activeMonitor;
  if (!m) return;
  savedPanelViewport.value = { zoom: m.zoom, panX: m.panX, panY: m.panY };
}

function restorePanelViewport() {
  const m = projectStore.activeMonitor;
  const s = savedPanelViewport.value;
  if (!m || !s) return;
  m.zoom = s.zoom;
  m.panX = s.panX;
  m.panY = s.panY;
}

function restoreViewAfterFullscreen() {
  if (projectStore.lastViewBeforeFullscreen) {
    projectStore.setView(projectStore.lastViewBeforeFullscreen);
  } else {
    projectStore.goToCut();
  }
}

// isBrowserFullscreen drives the actual enter/exit lifecycle
watch(isBrowserFullscreen, (entering) => {
  if (entering) {
    projectStore.goToFullscreen();
    focusStore.setMainFocus('monitor');
    // Fit to the new (larger) viewport after layout settles
    void nextTick(() => {
      (viewportRef.value as any)?.fitMonitor?.();
    });
  } else {
    if (projectStore.currentView === 'fullscreen') {
      restoreViewAfterFullscreen();
    }
    // Restore panel zoom/pan after Vue re-renders with the old viewport size
    void nextTick(() => {
      restorePanelViewport();
    });
  }
});

// projectStore.currentView drives programmatic fullscreen transitions (e.g. keyboard shortcut)
watch(
  () => projectStore.currentView,
  (view, prev) => {
    if ((view as string) === 'fullscreen' && !isBrowserFullscreen.value) {
      if ((prev as string) !== 'fullscreen') {
        capturePanelViewport();
      }
      void enterBrowserFullscreen();
    } else if ((view as string) !== 'fullscreen' && isBrowserFullscreen.value) {
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
  const raw = Number(projectStore.activeMonitor?.previewResolution);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return (
    previewResolutions.value.find((r) => Math.abs(r.value - raw) < 0.001) ?? {
      label: `${raw}p`,
      value: raw,
      isProject: Math.abs(raw - projectStore.projectSettings.project.height) < 0.001,
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

const isIdle = ref(false);
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function resetIdle() {
  isIdle.value = false;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    isIdle.value = true;
  }, 2000);
}

onMounted(() => window.addEventListener('mousemove', resetIdle));
onUnmounted(() => {
  window.removeEventListener('mousemove', resetIdle);
  clearTimeout(idleTimer);
});
</script>

<template>
  <div class="h-full">
    <!--
      UiContextMenuPortal attaches a contextmenu listener directly to panelRef via addEventListener.
      Using only this (no UContextMenu wrapper) avoids double context menu.
      It works in both normal mode and browser fullscreen because it teleports inside panelRef.
    -->
    <UiContextMenuPortal :items="contextMenuItems" :target-el="panelRef" />

    <!-- panelRef is always rendered unconditionally so useFullscreen keeps a stable DOM target -->
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
            !props.useExternalFocus && !effectiveFullscreen && focusStore.isPanelFocused('monitor'),
          'border-r border-ui-border': !effectiveFullscreen,
        },
      ]"
      @pointerdown.capture="!props.useExternalFocus && focusStore.setMainFocus('monitor')"
    >
      <!-- Video area -->
      <MonitorViewport ref="viewportRef" :render-width="renderWidth" :render-height="renderHeight">
        <template #canvas>
          <div ref="containerEl" class="absolute inset-0" style="pointer-events: none" />
        </template>

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
              effectiveFullscreen ? 'bottom-24 right-8' : 'bottom-3 right-3',
              effectiveFullscreen && isIdle ? 'opacity-0' : 'opacity-100',
            ]"
          >
            00:00:00:00 / 00:00:00:00
          </span>
        </template>
      </MonitorViewport>

      <!-- Playback controls bar -->
      <div
        class="flex flex-wrap items-center justify-center gap-3 border-ui-border shrink-0 transition-all duration-300 select-none"
        :class="[
          effectiveFullscreen
            ? 'absolute bottom-8 left-1/2 -translate-x-1/2 bg-ui-bg-elevated/80 backdrop-blur-xl px-6 py-3 rounded-2xl shadow-2xl z-50 border-none'
            : ['px-4 py-3.5 bg-ui-bg-elevated', props.panelDragCursorClass],
          effectiveFullscreen && isIdle ? 'opacity-0 pointer-events-none' : 'opacity-100',
          !effectiveFullscreen && toolbarPosition === 'bottom' ? 'border-t' : '',
          !effectiveFullscreen && toolbarPosition === 'top' ? 'border-b' : '',
          !effectiveFullscreen && toolbarPosition === 'right' ? 'border-l' : '',
          !effectiveFullscreen && toolbarPosition === 'left' ? 'border-r' : '',
          toolbarPosition === 'left' || toolbarPosition === 'right' ? 'flex-col' : '',
        ]"
        :draggable="!effectiveFullscreen"
        @dragstart="(e) => emit('panelDragStart', e)"
        @mouseenter="resetIdle"
      >
        <!-- Left cluster: utility buttons -->
        <div
          class="flex items-center gap-2 shrink-0"
          :class="toolbarPosition === 'left' || toolbarPosition === 'right' ? 'flex-col' : ''"
        >
          <UiTooltip :text="t('fastcat.timeline.addMarkerAtPlayhead', 'Add marker at playhead')">
            <UiActionButton
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-heroicons-bookmark"
              @click="createMarkerAtPlayhead"
            />
          </UiTooltip>

          <UiTooltip :text="t('fastcat.monitor.center', 'Center')">
            <UiActionButton
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-crosshair"
              @click="centerMonitor"
            />
          </UiTooltip>

          <UiTooltip :text="t('fastcat.monitor.resetZoom', 'Reset zoom')">
            <UiActionButton
              size="xs"
              color="neutral"
              variant="ghost"
              class="font-mono tabular-nums min-w-12 justify-center"
              :label="monitorZoomLabel"
              @click="resetZoom"
            />
          </UiTooltip>

          <UiTooltip :text="t('fastcat.monitor.useProxy', 'Use proxy')">
            <UiToggleButton
              v-if="projectStore.activeMonitor"
              :model-value="useProxyInMonitor"
              icon="i-heroicons-bolt"
              inactive-color="neutral"
              inactive-variant="ghost"
              active-color="neutral"
              active-variant="soft"
              :active-bg="'rgba(59,130,246,0.12)'"
              title="Use proxy"
              no-toggle
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
            <UiToggleButton
              v-if="projectStore.activeMonitor"
              :model-value="previewEffectsEnabled"
              icon="i-heroicons-sparkles"
              inactive-color="neutral"
              inactive-variant="ghost"
              active-color="neutral"
              active-variant="soft"
              :active-bg="'rgba(59,130,246,0.12)'"
              title="Preview effects"
              no-toggle
              @click="togglePreviewEffects"
            />
          </UiTooltip>

          <div class="w-auto min-w-14">
            <UiSelect
              v-if="projectStore.activeMonitor"
              :model-value="selectedPreviewResolution as any"
              :items="previewResolutions"
              value-key="value"
              label-key="label"
              full-width
              @update:model-value="
                (v: unknown) => {
                  if (v && projectStore.activeMonitor)
                    projectStore.activeMonitor.previewResolution = ((v as { value: number })
                      .value ?? v) as number;
                }
              "
            >
              <template #default="{ modelValue }">
                <span class="truncate text-2xs leading-none font-medium">
                  {{ (modelValue as any)?.shortLabel || (modelValue as any)?.label }}
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
            </UiSelect>
          </div>

          <UiActionButton
            v-if="effectiveFullscreen"
            size="sm"
            color="neutral"
            variant="solid"
            icon="i-heroicons-arrow-left"
            :label="t('common.back', 'Back')"
            @click="exitBrowserFullscreen()"
          />
          <UiActionButton
            v-else
            size="xs"
            color="neutral"
            variant="ghost"
            icon="i-heroicons-arrows-pointing-out"
            :title="t('fastcat.monitor.fullscreen', 'Fullscreen')"
            @click="enterBrowserFullscreen()"
          />
        </div>

        <!-- Playback buttons — right-click opens speed selector -->
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
              setPlayback({ direction: 'backward', speed: selectedPlaybackSpeedOption?.value ?? 1 })
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
              setPlayback({ direction: 'forward', speed: selectedPlaybackSpeedOption?.value ?? 1 })
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
                class="absolute text-3xs font-mono leading-none opacity-90 pointer-events-none"
                style="right: 4px; bottom: 0"
              >
                {{ selectedPlaybackSpeedOption?.label }}
              </span>
            </div>
          </UButton>
        </UContextMenu>

        <MonitorAudioControl :compact="toolbarPosition === 'left' || toolbarPosition === 'right'" />

        <!-- "More" dropdown duplicates the context menu items for discoverability -->
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
  </div>
</template>
