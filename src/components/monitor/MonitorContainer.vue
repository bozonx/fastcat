<script setup lang="ts">
import UiTooltip from '~/components/ui/UiTooltip.vue';
import UiContextMenuPortal from '~/components/ui/UiContextMenuPortal.vue';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useFullscreen } from '@vueuse/core';
import { useFocusStore } from '~/stores/focus.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useMonitorContainerControls } from '~/composables/monitor/useMonitorContainerControls';
import { useMonitorGrid } from '~/composables/monitor/useMonitorGrid';
import { useMonitorRuntime } from '~/composables/monitor/useMonitorRuntime';
import { TIMELINES_DIR_NAME } from '~/utils/constants';
import { serializeTimelineToOtio } from '~/timeline/otio-serializer';
import type { TimelineMarker } from '~/timeline/types';
import MonitorAudioControl from './MonitorAudioControl.vue';
import MonitorTextTransformBox from './MonitorTextTransformBox.vue';
import MonitorViewport from './MonitorViewport.vue';
import MonitorTransformBox from './MonitorTransformBox.vue';
import { registerMonitorActions } from '~/composables/editor/hotkeys/monitorActions';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { useProjectActions } from '~/composables/editor/useProjectActions';
import { useHotkeyLabel } from '~/composables/useHotkeyLabel';

const { t } = useI18n();
const toast = useToast();
const focusStore = useFocusStore();
const projectStore = useProjectStore();
const timelineStore = useTimelineStore();
const { timelineDoc } = storeToRefs(timelineStore);
const fileManager = useFileManager();
const { loadTimeline } = useProjectActions();
const { getHotkeyTitle } = useHotkeyLabel();

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
  uiCurrentTimeUs,
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
  contextMenuItems,
  createMarkerAtPlayhead,
  handleBoundaryWheel,
  handleEndBoundaryWheel,
  handleSpeedWheel,
  resetZoom,
  rewindToEnd,
  rewindToStart,
  selectedPlaybackSpeedOption,
  setPlayback,
  speedButtonLabel,
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

const monitorZoomLabel = computed(() => {
  const zoom = projectStore.activeMonitor?.zoom ?? 1;
  return `x${zoom.toFixed(2)}`;
});

const isIdle = ref(false);
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function resetIdle() {
  isIdle.value = false;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    isIdle.value = true;
  }, 2000);
}

onMounted(() => {
  window.addEventListener('mousemove', resetIdle);
  // Synchronize timecode transition target
  if (viewportRef.value) {
    timecodeEl.value = (viewportRef.value as any).timecodeEl;
  }
});

onUnmounted(() => {
  window.removeEventListener('mousemove', resetIdle);
  clearTimeout(idleTimer);
});

watch(viewportRef, (vp) => {
  if (vp) {
    timecodeEl.value = (vp as any).timecodeEl;
  }
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
      class="panel-focus-frame flex h-full min-w-0 min-h-0 transition-colors duration-300 relative select-none"
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
      <MonitorViewport
        ref="viewportRef"
        :render-width="renderWidth"
        :render-height="renderHeight"
        :is-idle="isIdle"
        :effective-fullscreen="effectiveFullscreen"
        :ui-current-time-us="uiCurrentTimeUs"
      >
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
        </template>
      </MonitorViewport>

      <!-- Playback controls bar -->
      <div
        class="flex flex-wrap items-center justify-center gap-3 border-ui-border shrink-0 transition-all duration-300 select-none"
        :class="[
          effectiveFullscreen
            ? [
                'absolute bg-ui-bg-elevated/80 backdrop-blur-xl rounded-2xl shadow-2xl z-50 border-none transition-all duration-300',
                toolbarPosition === 'left' || toolbarPosition === 'right'
                  ? 'top-1/2 -translate-y-1/2 px-3 py-6 flex-col'
                  : 'bottom-8 left-1/2 -translate-x-1/2 px-6 py-3 flex-row',
                toolbarPosition === 'left' ? 'left-8' : '',
                toolbarPosition === 'right' ? 'right-8' : '',
              ]
            : [
                toolbarPosition === 'left' || toolbarPosition === 'right'
                  ? 'px-1.5 py-3'
                  : 'px-4 py-3.5',
                'bg-ui-bg-elevated',
                props.panelDragCursorClass,
              ],
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
        <template v-if="effectiveFullscreen">
          <UiTooltip
            :text="
              getHotkeyTitle(
                t('fastcat.monitor.exitFullscreen', 'Exit fullscreen'),
                'general.fullscreen',
              )
            "
          >
            <UiActionButton
              size="sm"
              color="neutral"
              variant="solid"
              icon="lucide:minimize"
              :aria-label="t('fastcat.monitor.exitFullscreen', 'Exit fullscreen')"
              @click="exitBrowserFullscreen()"
            />
          </UiTooltip>
        </template>
        <template v-else>
          <UiTooltip
            :text="
              getHotkeyTitle(t('fastcat.monitor.fullscreen', 'Fullscreen'), 'general.fullscreen')
            "
          >
            <UiActionButton
              size="xs"
              color="neutral"
              variant="ghost"
              icon="lucide:maximize"
              :aria-label="t('fastcat.monitor.fullscreen', 'Fullscreen')"
              @click="enterBrowserFullscreen()"
            />
          </UiTooltip>
        </template>

        <UiTooltip :text="t('fastcat.monitor.resetZoom', 'Reset zoom')">
          <UiActionButton
            size="xs"
            color="neutral"
            variant="ghost"
            class="font-mono tabular-nums min-w-10 justify-center text-[10px] px-0! hover:bg-transparent! text-ui-text-muted hover:text-ui-text"
            hover-class=""
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
            :active-bg="'color-mix(in srgb, var(--selection-accent-500) 12%, transparent)'"
            :active-text="'var(--selection-accent-400)'"
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
            :active-bg="'color-mix(in srgb, var(--selection-accent-500) 12%, transparent)'"
            :active-text="'var(--selection-accent-400)'"
            title="Preview effects"
            no-toggle
            @click="togglePreviewEffects"
          />
        </UiTooltip>

        <!-- Playback buttons — wheel on play button changes speed -->
        <UiTooltip
          :text="getHotkeyTitle(t('fastcat.monitor.rewind', 'Rewind'), 'playback.toStart')"
        >
          <UButton
            size="md"
            variant="ghost"
            color="neutral"
            icon="i-lucide-skip-back"
            :aria-label="t('fastcat.monitor.rewind', 'Rewind')"
            :disabled="!canInteractPlayback"
            @click="
              (e) => {
                rewindToStart();
                (e.currentTarget as HTMLElement).blur();
              }
            "
            @wheel.prevent="handleBoundaryWheel"
          />
        </UiTooltip>

        <UiTooltip :text="getHotkeyTitle(t('fastcat.monitor.play', 'Play'), 'playback.toggle')">
          <UButton
            size="md"
            variant="solid"
            color="neutral"
            class="relative overflow-hidden min-w-8 px-1.5"
            :aria-label="t('fastcat.monitor.play', 'Play')"
            :disabled="!canInteractPlayback"
            @click="
              (e) => {
                setPlayback(selectedPlaybackSpeedOption?.value ?? 1);
                (e.currentTarget as HTMLElement).blur();
              }
            "
            @wheel.prevent="handleSpeedWheel"
          >
            <div class="flex items-center justify-center">
              <UIcon
                v-if="timelineStore.isPlaying"
                name="i-heroicons-stop-20-solid"
                class="w-5 h-5"
              />
              <UIcon
                v-else-if="(selectedPlaybackSpeedOption?.value ?? 1) < 0"
                name="i-heroicons-play-20-solid"
                class="w-5 h-5 scale-x-[-1]"
              />
              <UIcon v-else name="i-heroicons-play-20-solid" class="w-5 h-5 ml-0.5" />
              <span
                class="absolute text-3xs font-mono leading-none opacity-90 pointer-events-none"
                style="right: 4px; bottom: 0"
              >
                {{ speedButtonLabel }}
              </span>
            </div>
          </UButton>
        </UiTooltip>

        <UiTooltip :text="t('fastcat.monitor.end', 'End')">
          <UButton
            size="md"
            variant="ghost"
            color="neutral"
            icon="i-lucide-skip-forward"
            :aria-label="t('fastcat.monitor.end', 'End')"
            :disabled="!canInteractPlayback"
            @click="
              (e) => {
                rewindToEnd();
                (e.currentTarget as HTMLElement).blur();
              }
            "
            @wheel.prevent="handleEndBoundaryWheel"
          />
        </UiTooltip>

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
