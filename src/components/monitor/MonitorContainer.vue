<script setup lang="ts">
import UiTooltip from '~/components/ui/UiTooltip.vue';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useAppFullscreen } from '~/composables/useAppFullscreen';
import { useFocusStore } from '~/stores/focus.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useMonitorContainerControls } from '~/composables/monitor/useMonitorContainerControls';
import { useMonitorGrid } from '~/composables/monitor/useMonitorGrid';
import { useMonitorRuntime } from '~/composables/monitor/useMonitorRuntime';
import { useMonitorFullscreenViewport } from '~/composables/monitor/useMonitorFullscreenViewport';
import { useThrottleFn } from '@vueuse/core';
import MonitorAudioControl from './MonitorAudioControl.vue';
import MonitorViewport from './MonitorViewport.vue';
import MonitorOverlayContent from './MonitorOverlayContent.vue';
import { registerMonitorActions } from '~/composables/editor/hotkeys/monitorActions';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { useProjectActions } from '~/composables/editor/useProjectActions';
import { useHotkeyLabel } from '~/composables/useHotkeyLabel';
import { dropdownNoReturnFocus } from '~/composables/useDropdownMenuFocus';
import { isTauriRuntime } from '~/utils/runtime';
import { formatTimecode } from '~/utils/time';

const { t } = useI18n();
const toast = useToast();
const focusStore = useFocusStore();
const projectStore = useProjectStore();
const timelineStore = useTimelineStore();
const workspaceStore = useWorkspaceStore();
const fileManager = useFileManager();
const { loadTimeline } = useProjectActions();
const { getHotkeyTitle } = useHotkeyLabel();

async function createNewTimeline() {
  const createdPath = await fileManager.createTimeline();
  if (createdPath) {
    await loadTimeline(createdPath);
    toast.add({
      color: 'success',
      title: t('timelineCreation.successTitle'),
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
} = useAppFullscreen(panelRef);

const {
  selectionStore,
  videoItems,
  safeDurationUs,
  isTextClipSelected,
  isAdjustmentClipSelected,
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

const seekbarRef = ref<HTMLElement | null>(null);
const isDraggingSeekbar = ref(false);
const isHoveringSeekbar = ref(false);
const hoverPercent = ref(0);
const hoverTimecode = ref('');

const showTooltip = computed(
  () => (isHoveringSeekbar.value || isDraggingSeekbar.value) && safeDurationUs.value > 0,
);

const throttledScrollToPlayhead = useThrottleFn(() => {
  timelineStore.requestScrollToPlayhead?.();
}, 100);

const progressPercent = computed(() => {
  if (safeDurationUs.value <= 0) return 0;
  return (uiCurrentTimeUs.value / safeDurationUs.value) * 100;
});

function updateHoverState(event: PointerEvent) {
  if (!seekbarRef.value || safeDurationUs.value <= 0) return;
  const rect = seekbarRef.value.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const width = rect.width;
  const pct = Math.max(0, Math.min(1, x / width));
  hoverPercent.value = pct * 100;

  const targetTimeUs = Math.round(pct * safeDurationUs.value);
  const fps = timelineStore.timelineFormat?.fps ?? timelineStore.fps;
  hoverTimecode.value = formatTimecode(targetTimeUs, fps);
}

function handleSeekEvent(event: PointerEvent) {
  if (!seekbarRef.value || safeDurationUs.value <= 0) return;
  const rect = seekbarRef.value.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const width = rect.width;
  const pct = Math.max(0, Math.min(1, x / width));
  const targetTimeUs = Math.round(pct * safeDurationUs.value);
  timelineStore.setCurrentTimeUs(targetTimeUs);
  throttledScrollToPlayhead();
}

function onSeekbarPointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  isDraggingSeekbar.value = true;
  handleSeekEvent(event);
  updateHoverState(event);
  seekbarRef.value?.setPointerCapture(event.pointerId);
  event.stopPropagation();
  resetIdleTimeout();
}

function onSeekbarPointerMove(event: PointerEvent) {
  updateHoverState(event);
  if (isDraggingSeekbar.value) {
    handleSeekEvent(event);
  }
  event.stopPropagation();
  resetIdleTimeout();
}

function onSeekbarPointerUp(event: PointerEvent) {
  if (!isDraggingSeekbar.value) return;
  isDraggingSeekbar.value = false;
  isHoveringSeekbar.value = false;
  seekbarRef.value?.releasePointerCapture(event.pointerId);
  event.stopPropagation();
  resetIdleTimeout();
  timelineStore.requestScrollToPlayhead?.();
}

registerMonitorActions({
  createStopFrameSnapshot,
  createNewTimeline,
});

const props = withDefaults(
  defineProps<{
    isFullscreen?: boolean;
    useExternalFocus?: boolean;
    panelDragCursorClass?: string;
    inDevelopmentFeaturesEnabled?: boolean;
  }>(),
  {
    isFullscreen: false,
    useExternalFocus: false,
    panelDragCursorClass: 'cursor-grab active:cursor-grabbing',
    inDevelopmentFeaturesEnabled: false,
  },
);

const emit = defineEmits<{
  panelDragStart: [e: DragEvent];
}>();

function onPanelDragStart(e: DragEvent) {
  emit('panelDragStart', e);
}

const effectiveFullscreen = computed(() => props.isFullscreen || isBrowserFullscreen.value);
const shouldTeleport = computed(() => isTauriRuntime() && effectiveFullscreen.value);
const monitorMenuPortal = computed(() =>
  effectiveFullscreen.value ? (panelRef.value ?? false) : true,
);

const { capturePanelViewport, restorePanelViewport } = useMonitorFullscreenViewport(projectStore);

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
    capturePanelViewport();
    projectStore.goToFullscreen();
    focusStore.setMainFocus('monitor');
    // Fit to the new (larger) viewport after layout settles
    void nextTick(() => {
      void nextTick(() => {
        (viewportRef.value as { fitMonitor?: () => void })?.fitMonitor?.();
      });
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
  handleBoundaryWheel,
  handleEndBoundaryWheel,
  handleSpeedWheel,
  resetView,
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
  workspaceStore,
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

const isInteractiveEditEnabled = computed(
  () => workspaceStore.inDevelopmentFeaturesEnabled === true,
);

const monitorZoomLabel = computed(() => {
  const zoom = projectStore.activeMonitor?.zoom ?? 1;
  return `x${zoom.toFixed(2)}`;
});

const isMonitorMoreMenuOpen = ref(false);
const isMonitorContextMenuOpen = ref(false);

function setMonitorContextMenuOpen(isOpen: boolean) {
  isMonitorContextMenuOpen.value = isOpen;
}

function setMonitorMoreMenuOpen(isOpen: boolean) {
  isMonitorMoreMenuOpen.value = isOpen;
}

function closeMonitorMenus() {
  if (!isMonitorContextMenuOpen.value && !isMonitorMoreMenuOpen.value) {
    return;
  }
  isMonitorContextMenuOpen.value = false;
  isMonitorMoreMenuOpen.value = false;
}

function onMonitorKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    if (isMonitorContextMenuOpen.value || isMonitorMoreMenuOpen.value) {
      closeMonitorMenus();
      event.stopPropagation();
      return;
    }
    if (effectiveFullscreen.value) {
      void exitBrowserFullscreen();
      event.stopPropagation();
    }
  }
}

const isIdle = ref(false);
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function clearIdleTimeout() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = undefined;
  }
}

function blurActiveElementInControls() {
  const controlsBar = panelRef.value?.querySelector('[data-panel-drag-handle]');
  if (controlsBar && controlsBar.contains(document.activeElement)) {
    (document.activeElement as HTMLElement).blur();
  }
}

function showControlsTemporary() {
  isIdle.value = false;
  clearIdleTimeout();
  if (effectiveFullscreen.value) {
    idleTimer = setTimeout(() => {
      if (isMonitorMoreMenuOpen.value || isMonitorContextMenuOpen.value) {
        showControlsTemporary();
      } else {
        blurActiveElementInControls();
        isIdle.value = true;
      }
    }, 3000);
  }
}

function hideControlsImmediate() {
  blurActiveElementInControls();
  isIdle.value = true;
  clearIdleTimeout();
}

function keepControlsVisible() {
  isIdle.value = false;
  clearIdleTimeout();
}

function resetIdleTimeout() {
  if (effectiveFullscreen.value && !isIdle.value) {
    showControlsTemporary();
  }
}

watch(effectiveFullscreen, (entering) => {
  clearIdleTimeout();
  if (entering) {
    showControlsTemporary();
  } else {
    isIdle.value = false;
  }
});

function handleContainerClick(event: MouseEvent) {
  if (!effectiveFullscreen.value) return;

  const target = event.target as HTMLElement;

  // Check if click is inside the controls bar (panel)
  const controlsBar = panelRef.value?.querySelector('[data-panel-drag-handle]');
  if (controlsBar && controlsBar.contains(target)) {
    // Play button: start delayed hide with animation when playing,
    // keep visible when paused
    if (target.closest('[data-monitor-play]')) {
      if (timelineStore.isPlaying) {
        showControlsTemporary();
      } else {
        keepControlsVisible();
      }
    } else {
      keepControlsVisible();
    }
    return;
  }

  // Check if click is inside any active dropdown or context menus
  if (
    target.closest('.u-dropdown-menu') ||
    target.closest('.u-context-menu') ||
    target.closest('[role="menu"]')
  ) {
    return;
  }

  // Toggle controls visibility
  if (isIdle.value) {
    showControlsTemporary();
  } else {
    hideControlsImmediate();
  }
}

onMounted(() => {
  window.addEventListener('keydown', onMonitorKeyDown, { capture: true });
  // Synchronize timecode transition target
  if (viewportRef.value) {
    timecodeEl.value = (viewportRef.value as { timecodeEl?: HTMLElement }).timecodeEl ?? null;
  }
  if (effectiveFullscreen.value) {
    showControlsTemporary();
  }
});

onUnmounted(() => {
  window.removeEventListener('keydown', onMonitorKeyDown, { capture: true });
  clearIdleTimeout();
});

watch(viewportRef, (vp) => {
  if (vp) {
    timecodeEl.value = (vp as { timecodeEl?: HTMLElement }).timecodeEl ?? null;
    if (effectiveFullscreen.value) {
      (vp as { fitMonitor?: () => void })?.fitMonitor?.();
    }
  }
});
</script>

<template>
  <div class="h-full">
    <Teleport to="body" :disabled="!shouldTeleport">
      <!-- panelRef is always rendered unconditionally so useFullscreen keeps a stable DOM target -->
      <UContextMenu
        :open="isMonitorContextMenuOpen"
        :items="contextMenuItems"
        :portal="monitorMenuPortal"
        :ui="{ content: 'z-[60]' }"
        :content="dropdownNoReturnFocus"
        @update:open="setMonitorContextMenuOpen"
      >
        <div
          ref="panelRef"
          class="panel-focus-frame flex h-full min-w-0 min-h-0 transition-colors duration-300 relative select-none"
          :class="[
            effectiveFullscreen
              ? 'fixed inset-0 z-50 h-screen w-screen bg-black flex-col'
              : 'bg-ui-bg-elevated',
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
          @click="handleContainerClick"
          @pointerdown.capture="!props.useExternalFocus && focusStore.setMainFocus('monitor')"
        >
          <!-- Video area with Seekbar -->
          <div class="relative flex-1 min-h-0 min-w-0 flex flex-col justify-between">
            <MonitorViewport
              ref="viewportRef"
              :render-width="renderWidth"
              :render-height="renderHeight"
              :is-idle="isIdle"
              :effective-fullscreen="effectiveFullscreen"
              :ui-current-time-us="uiCurrentTimeUs"
              @pointerdown.capture="closeMonitorMenus"
            >
              <template #canvas>
                <div ref="containerEl" class="absolute inset-0" style="pointer-events: none" />
              </template>

              <template #svg-overlay>
                <MonitorOverlayContent
                  :render-width="renderWidth"
                  :render-height="renderHeight"
                  :show-grid="showGrid"
                  :get-grid-lines="getGridLines"
                  :is-interactive-edit-enabled="isInteractiveEditEnabled"
                  :is-readonly="isReadonly"
                  :is-text-clip-selected="isTextClipSelected"
                  :is-adjustment-clip-selected="isAdjustmentClipSelected"
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

            <!-- Monitor Seekbar / Progress line -->
            <div
              v-if="safeDurationUs > 0"
              class="absolute left-0 right-0 z-30 transition-all duration-300 pointer-events-auto select-none"
              :class="[
                effectiveFullscreen && isIdle ? 'opacity-0 pointer-events-none' : 'opacity-100',
                effectiveFullscreen
                  ? [
                      'px-8 pb-3',
                      toolbarPosition === 'left' || toolbarPosition === 'right'
                        ? 'bottom-6'
                        : 'bottom-20',
                    ]
                  : toolbarPosition === 'bottom'
                    ? 'bottom-[-8px] px-0 pb-0'
                    : 'bottom-2 px-3 pb-0',
              ]"
              @pointerdown="onSeekbarPointerDown"
              @pointermove="onSeekbarPointerMove"
              @pointerup="onSeekbarPointerUp"
              @pointercancel="onSeekbarPointerUp"
            >
              <div
                ref="seekbarRef"
                data-testid="monitor-seekbar"
                class="relative h-4 flex items-center cursor-pointer group"
                @pointerenter="isHoveringSeekbar = true"
                @pointerleave="isHoveringSeekbar = false"
              >
                <!-- Background Track -->
                <div
                  class="absolute left-0 right-0 h-1 bg-ui-border rounded-full transition-all duration-150"
                  :class="{ 'h-1.5': isDraggingSeekbar }"
                ></div>
                <!-- Progress Fill -->
                <div
                  class="absolute left-0 h-1 bg-ui-text-muted rounded-full transition-all duration-150"
                  :class="{ 'h-1.5 bg-ui-text': isDraggingSeekbar }"
                  :style="{ width: `${progressPercent}%` }"
                ></div>
                <!-- Thumb/Marker -->
                <div
                  class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full shadow-md transition-all duration-150 pointer-events-auto"
                  :class="[
                    isDraggingSeekbar
                      ? 'bg-selection-accent-500 opacity-100 scale-100'
                      : 'bg-ui-text opacity-0 scale-75 group-hover:opacity-100 group-hover:scale-100 hover:bg-selection-accent-500',
                  ]"
                  :style="{ left: `${progressPercent}%` }"
                ></div>

                <!-- Hover Timecode Tooltip -->
                <Transition
                  enter-active-class="transition duration-150 ease-out"
                  enter-from-class="opacity-0 scale-95"
                  enter-to-class="opacity-100 scale-100"
                  leave-active-class="transition duration-150 ease-in"
                  leave-from-class="opacity-100 scale-100"
                  leave-to-class="opacity-0 scale-95"
                >
                  <div
                    v-if="showTooltip"
                    data-testid="monitor-seekbar-tooltip"
                    class="absolute bottom-full mb-2.5 -translate-x-1/2 pointer-events-none z-50 bg-ui-bg-elevated/95 dark:bg-black/90 backdrop-blur-md border border-ui-border rounded px-2 py-0.5 text-3xs font-mono tabular-nums text-ui-text shadow-xl"
                    :style="{ left: `${hoverPercent}%` }"
                  >
                    {{ hoverTimecode }}
                  </div>
                </Transition>
              </div>
            </div>
          </div>

          <!-- Playback controls bar -->
          <div
            data-panel-drag-handle
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
                    props.inDevelopmentFeaturesEnabled ? props.panelDragCursorClass : '',
                  ],
              effectiveFullscreen && isIdle ? 'opacity-0 pointer-events-none' : 'opacity-100',
              !effectiveFullscreen && toolbarPosition === 'bottom' ? 'border-t' : '',
              !effectiveFullscreen && toolbarPosition === 'top' ? 'border-b' : '',
              !effectiveFullscreen && toolbarPosition === 'right' ? 'border-l' : '',
              !effectiveFullscreen && toolbarPosition === 'left' ? 'border-r' : '',
              toolbarPosition === 'left' || toolbarPosition === 'right' ? 'flex-col' : '',
            ]"
            :draggable="!effectiveFullscreen && props.inDevelopmentFeaturesEnabled"
            @dragstart="props.inDevelopmentFeaturesEnabled ? onPanelDragStart : undefined"
            @mouseenter="keepControlsVisible"
            @mousemove="keepControlsVisible"
          >
            <!-- Left cluster: utility buttons -->
            <template v-if="workspaceStore.inDevelopmentFeaturesEnabled">
              <template v-if="effectiveFullscreen">
                <UiTooltip
                  :text="getHotkeyTitle(t('fastcat.monitor.exitFullscreen'), 'general.fullscreen')"
                >
                  <UiActionButton
                    size="sm"
                    color="neutral"
                    variant="ghost"
                    icon="lucide:minimize"
                    :aria-label="t('fastcat.monitor.exitFullscreen')"
                    @click="exitBrowserFullscreen()"
                  />
                </UiTooltip>
              </template>
              <template v-else>
                <UiTooltip
                  :text="getHotkeyTitle(t('fastcat.monitor.fullscreen'), 'general.fullscreen')"
                >
                  <UiActionButton
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    icon="lucide:maximize"
                    :aria-label="t('fastcat.monitor.fullscreen')"
                    @click="enterBrowserFullscreen()"
                  />
                </UiTooltip>
              </template>
            </template>

            <UiTooltip :text="getHotkeyTitle(t('fastcat.monitor.resetZoom'), 'general.zoomReset')">
              <UiActionButton
                size="xs"
                color="neutral"
                variant="ghost"
                class="font-mono tabular-nums min-w-10 justify-center text-[10px] px-0! hover:bg-transparent! text-ui-text-muted hover:text-ui-text"
                hover-class=""
                :label="monitorZoomLabel"
                @click="resetZoom"
                @dblclick="resetView"
              />
            </UiTooltip>

            <UiTooltip :text="t('fastcat.monitor.useProxy')">
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
                no-toggle
                @click="toggleProxyUsage"
              />
            </UiTooltip>

            <UiTooltip
              :text="
                previewEffectsEnabled
                  ? t('fastcat.monitor.previewWithEffects')
                  : t('fastcat.monitor.previewWithoutEffects')
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
                no-toggle
                @click="togglePreviewEffects"
              />
            </UiTooltip>

            <!-- Playback buttons — wheel on play button changes speed -->
            <UiTooltip :text="getHotkeyTitle(t('fastcat.monitor.rewind'), 'playback.toStart')">
              <UiActionButton
                size="md"
                variant="ghost"
                color="neutral"
                icon="i-lucide-skip-back"
                :aria-label="t('fastcat.monitor.rewind')"
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

            <UiTooltip :text="getHotkeyTitle(t('fastcat.monitor.play'), 'playback.toggle')">
              <UButton
                size="md"
                variant="solid"
                color="neutral"
                data-monitor-play
                class="relative overflow-hidden min-w-8 px-1.5"
                :aria-label="t('fastcat.monitor.play')"
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

            <UiTooltip :text="getHotkeyTitle(t('fastcat.monitor.end'), 'playback.toEnd')">
              <UiActionButton
                size="md"
                variant="ghost"
                color="neutral"
                icon="i-lucide-skip-forward"
                :aria-label="t('fastcat.monitor.end')"
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

            <MonitorAudioControl
              :compact="toolbarPosition === 'left' || toolbarPosition === 'right'"
            />

            <!-- "More" dropdown duplicates the context menu items for discoverability -->
            <UDropdownMenu
              :open="isMonitorMoreMenuOpen"
              :items="contextMenuItems"
              :portal="monitorMenuPortal"
              :ui="{ content: 'z-[60]' }"
              :content="dropdownNoReturnFocus"
              @update:open="setMonitorMoreMenuOpen"
            >
              <UiActionButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-heroicons-ellipsis-vertical-16-solid"
                square
                :title="t('common.more')"
              />
            </UDropdownMenu>
          </div>
        </div>
      </UContextMenu>
    </Teleport>
  </div>
</template>
