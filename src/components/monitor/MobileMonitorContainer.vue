<script setup lang="ts">
import { computed, ref, nextTick, watch, watchEffect } from 'vue';
import { storeToRefs } from 'pinia';
import { useFullscreen, useMediaQuery } from '@vueuse/core';
import { useMonitorGrid } from '~/composables/monitor/useMonitorGrid';
import { useMonitorRuntime } from '~/composables/monitor/useMonitorRuntime';
import MonitorTextTransformBox from './MonitorTextTransformBox.vue';
import MonitorViewport from './MonitorViewport.vue';
import MonitorTransformBox from './MonitorTransformBox.vue';
import MobileMonitorAudioControl from './MobileMonitorAudioControl.vue';
import { useMonitorContainerControls } from '~/composables/monitor/useMonitorContainerControls';
import type { TimelineMarker } from '~/timeline/types';
import ProjectMarkers from '~/components/project/ProjectMarkers.vue';

const props = withDefaults(
  defineProps<{
    mode?: 'edit' | 'sound';
    /** When true the monitor is positioned at the top (landscape + landscape project) */
    monitorAtTop?: boolean;
    /** When true removes fixed height/width constraints so the parent can control sizing */
    flexible?: boolean;
  }>(),
  {
    mode: 'edit',
    monitorAtTop: false,
    flexible: false,
  },
);

const { t } = useI18n();
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
  uiCurrentTimeUs,
} = useMonitorRuntime();

const { timelineDoc } = storeToRefs(timelineStore);

const canInteractPlayback = computed(
  () => !isLoading.value && (safeDurationUs.value > 0 || videoItems.value.length > 0),
);

const statusText = computed(() => {
  if (loadError.value) return 'Preview failed';
  if (isLoading.value) return 'Preparing preview';
  if (videoItems.value.length === 0) return 'Add media to preview it here';
  return props.mode === 'sound' ? 'Sound view' : 'Preview';
});

const { showGrid, toggleGrid, getGridLines } = useMonitorGrid({ projectStore });

const {
  contextMenuItems,
  toggleProxyUsage,
  togglePreviewEffects,
  resetZoom,
  onPlaybackSpeedChange,
  selectedPlaybackSpeedOption,
  speedButtonLabel,
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
  isMobile: true,
});

const MOBILE_SPEED_VALUES = [0.5, 1, 1.5, 2];

const mobileSpeedMenuItems = computed(() => [
  MOBILE_SPEED_VALUES.map((v) => ({
    label: `x${v}`,
    type: 'checkbox' as const,
    checked: selectedPlaybackSpeedOption.value?.value === v,
    onSelect: () => onPlaybackSpeedChange(v),
  })),
]);

const monitorZoomLabel = computed(() => {
  const zoom = projectStore.activeMonitor?.zoom ?? 1;
  return `x${zoom.toFixed(2)}`;
});

const containerRef = ref<HTMLElement | null>(null);
const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(containerRef);

const isContextMenuOpen = ref(false);

const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_THRESHOLD = 10;
let longPressTimer: ReturnType<typeof setTimeout> | null = null;
let longPressStartX = 0;
let longPressStartY = 0;

const DOUBLE_TAP_MS = 280;
let viewportTapTimer: ReturnType<typeof setTimeout> | null = null;

function clearLongPressTimer() {
  if (longPressTimer !== null) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

function onLongPressPointerDown(e: PointerEvent) {
  const target = e.target as HTMLElement;
  if (
    target.closest('button') ||
    target.closest('input') ||
    target.closest('[role="slider"]') ||
    target.closest('[role="menuitem"]')
  )
    return;
  longPressStartX = e.clientX;
  longPressStartY = e.clientY;
  longPressTimer = setTimeout(() => {
    longPressTimer = null;
    isContextMenuOpen.value = true;
    if (navigator.vibrate) navigator.vibrate(30);
  }, LONG_PRESS_MS);
}

function onLongPressPointerMove(e: PointerEvent) {
  if (longPressTimer === null) return;
  const dx = Math.abs(e.clientX - longPressStartX);
  const dy = Math.abs(e.clientY - longPressStartY);
  if (dx > LONG_PRESS_MOVE_THRESHOLD || dy > LONG_PRESS_MOVE_THRESHOLD) {
    clearLongPressTimer();
  }
}

function handleViewportClick(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (target.closest('button') || target.closest('[role="slider"]')) return;

  if (viewportTapTimer !== null) {
    clearTimeout(viewportTapTimer);
    viewportTapTimer = null;
    (viewportRef.value as any)?.fitMonitor?.();
  } else {
    viewportTapTimer = setTimeout(() => {
      viewportTapTimer = null;
    }, DOUBLE_TAP_MS);
  }
}

watch(isFullscreen, () => {
  void nextTick(() => {
    (viewportRef.value as any)?.fitMonitor?.();
  });
});

const isLandscape = useMediaQuery('(orientation: landscape)');

const isVerticalProject = computed(() => {
  const { width, height } = projectStore.projectSettings.project;
  return width < height;
});

const internalLayout = computed<'left' | 'right' | 'top' | 'bottom'>(() => {
  if (isFullscreen.value) return isLandscape.value ? 'right' : 'bottom';

  if (isVerticalProject.value) {
    // Left panel for portrait projects as requested
    return 'left';
  }

  /** For landscape projects: landscape browser -> top, portrait browser -> bottom */
  return isLandscape.value ? 'top' : 'bottom';
});

const showSideControls = computed(
  () => internalLayout.value === 'left' || internalLayout.value === 'right',
);

// --- Marker button logic ---
const isMarkersDrawerOpen = ref(false);
const markerLongPressTimer = ref<ReturnType<typeof setTimeout> | null>(null);
const wasMarkerLongPress = ref(false);
const MARKER_LONG_PRESS_MS = 500;

function startMarkerLongPress() {
  wasMarkerLongPress.value = false;
  if (markerLongPressTimer.value) clearTimeout(markerLongPressTimer.value);
  markerLongPressTimer.value = setTimeout(() => {
    isMarkersDrawerOpen.value = true;
    wasMarkerLongPress.value = true;
    markerLongPressTimer.value = null;
    if (navigator.vibrate) navigator.vibrate(50);
  }, MARKER_LONG_PRESS_MS);
}

function stopMarkerLongPress() {
  if (markerLongPressTimer.value) {
    clearTimeout(markerLongPressTimer.value);
    markerLongPressTimer.value = null;
  }
}

function handleMarkerClick() {
  if (wasMarkerLongPress.value) return;
  timelineStore.addMarkerAtPlayhead();
}

const isReadonly = computed(
  () => projectStore.currentView === 'sound' || projectStore.currentView === 'export',
);

onMounted(() => {
  if (viewportRef.value) {
    timecodeEl.value = (viewportRef.value as any).timecodeEl;
  }
});

watch(viewportRef, (vp) => {
  if (vp) {
    timecodeEl.value = (vp as any).timecodeEl;
  }
});

function blurActiveElement() {
  (document.activeElement as HTMLElement | null)?.blur?.();
}

function togglePlayback() {
  if (isLoading.value) return;
  if (loadError.value) {
    loadError.value = null;
    scheduleBuild();
    return;
  }
  timelineStore.togglePlayback();
  blurActiveElement();
}

function rewindToStart() {
  timelineStore.setCurrentTimeUs(0);
  blurActiveElement();
}

const containerHeightClass = computed(() => {
  if (props.flexible) return 'h-full w-full';
  return props.mode === 'sound'
    ? 'h-[30vh] min-h-[220px] max-h-[340px]'
    : 'h-[34vh] min-h-[240px] max-h-[420px]';
});
</script>

<template>
  <div
    ref="containerRef"
    class="flex min-w-0 shrink-0 border-ui-border bg-ui-bg-elevated transition-colors duration-200"
    :class="[
      isFullscreen ? 'fixed inset-0 z-50 h-screen w-screen' : [containerHeightClass],
      {
        'flex-row-reverse border-l': internalLayout === 'left',
        'flex-row border-r': internalLayout === 'right',
        'flex-col-reverse border-t': internalLayout === 'top',
        'flex-col border-b': internalLayout === 'bottom',
      },
    ]"
  >
    <!-- Video area -->
    <MonitorViewport
      ref="viewportRef"
      :render-width="renderWidth"
      :render-height="renderHeight"
      :effective-fullscreen="isFullscreen"
      :ui-current-time-us="uiCurrentTimeUs"
      :is-mobile="true"
      class="bg-black/80"
      @click="handleViewportClick"
      @pointerdown="onLongPressPointerDown"
      @pointermove="onLongPressPointerMove"
      @pointerup="clearLongPressTimer"
      @pointercancel="clearLongPressTimer"
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
          v-if="videoItems.length === 0"
          class="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-ui-text-disabled"
        >
          <UIcon name="lucide:play-circle" class="w-12 h-12" />
          <p class="text-sm text-ui-text-muted">{{ statusText }}</p>
        </div>
        <div
          v-else-if="loadError"
          class="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-red-300"
        >
          <UIcon name="lucide:triangle-alert" class="w-7 h-7" />
          <p class="text-sm font-medium">{{ statusText }}</p>
          <p class="text-xs text-red-200/80">{{ loadError }}</p>
        </div>
      </template>
    </MonitorViewport>

    <div
      class="shrink-0 bg-ui-bg"
      :class="[
        showSideControls
          ? 'w-[72px] flex flex-col items-center py-4 border-ui-border'
          : 'px-4 py-1.5 border-ui-border h-[64px]',
        {
          'border-r': internalLayout === 'left',
          'border-l': internalLayout === 'right',
          'border-b': internalLayout === 'top',
          'border-t': internalLayout === 'bottom',
        },
      ]"
      @pointerdown="onLongPressPointerDown"
      @pointermove="onLongPressPointerMove"
      @pointerup="clearLongPressTimer"
      @pointercancel="clearLongPressTimer"
    >
      <div
        class="flex gap-3"
        :class="[
          showSideControls
            ? 'flex-col justify-between h-full items-center'
            : 'items-center justify-between h-full',
        ]"
      >
        <div
          class="flex items-center gap-4 overflow-x-auto no-scrollbar"
          :class="[showSideControls ? 'flex-col' : '']"
        >
          <UButton
            size="xs"
            variant="ghost"
            color="neutral"
            :icon="isFullscreen ? 'lucide:minimize' : 'lucide:maximize'"
            class="p-1.5"
            :aria-label="t('fastcat.monitor.fullscreen', 'Fullscreen')"
            @click="toggleFullscreen"
          />

          <UButton
            size="xs"
            variant="ghost"
            color="neutral"
            icon="i-heroicons-bookmark"
            class="p-1.5"
            :aria-label="t('fastcat.timeline.addMarker', 'Add marker')"
            @click="handleMarkerClick"
            @pointerdown="startMarkerLongPress"
            @pointerup="stopMarkerLongPress"
            @pointerleave="stopMarkerLongPress"
          />

          <UButton
            size="xs"
            variant="ghost"
            color="neutral"
            class="font-mono tabular-nums text-[10px] min-w-10 justify-center h-6 px-1 text-ui-text-muted hover:text-ui-text"
            :label="monitorZoomLabel"
            @click="resetZoom"
          />

          <UDropdownMenu :items="mobileSpeedMenuItems" :ui="{ content: 'min-w-20' }">
            <UButton
              size="xs"
              variant="ghost"
              color="neutral"
              class="font-mono tabular-nums text-[10px] min-w-10 justify-center h-6 px-1 text-ui-text-muted hover:text-ui-text"
              :label="speedButtonLabel"
              :aria-label="t('fastcat.monitor.playbackSpeed', 'Playback speed')"
            />
          </UDropdownMenu>
        </div>

        <div class="flex items-center gap-4" :class="[showSideControls ? 'flex-col' : 'h-full']">
          <MobileMonitorAudioControl />

          <UButton
            size="md"
            variant="ghost"
            color="neutral"
            icon="lucide:skip-back"
            class="p-1"
            :aria-label="t('fastcat.monitor.rewind', 'Home')"
            :disabled="!canInteractPlayback"
            @click="rewindToStart"
          />

          <UButton
            variant="solid"
            color="primary"
            :icon="timelineStore.isPlaying ? 'lucide:pause' : 'lucide:play'"
            class="shadow-lg mx-2 flex items-center justify-center p-0!"
            :class="[
              showSideControls
                ? 'w-full aspect-square rounded-full'
                : 'h-full aspect-square rounded-full',
            ]"
            :ui="{ icon: 'w-8 h-8' }"
            :aria-label="t('fastcat.monitor.play', 'Play')"
            :disabled="!canInteractPlayback"
            @click="togglePlayback"
          />

          <UDropdownMenu v-model:open="isContextMenuOpen" :items="contextMenuItems">
            <UButton
              size="xs"
              variant="ghost"
              color="neutral"
              icon="lucide:ellipsis"
              class="p-1.5"
              :aria-label="t('common.more', 'More')"
            />
          </UDropdownMenu>
        </div>
      </div>
    </div>
    <!-- Markers drawer (long-press on marker button) -->
    <UiMobileDrawer
      v-model:open="isMarkersDrawerOpen"
      :title="t('videoEditor.fileManager.tabs.markers', 'Markers')"
      :snap-points="[0.4, 0.85]"
      direction="bottom"
    >
      <div class="px-4 pb-4 h-full overflow-hidden">
        <ProjectMarkers class="h-full" />
      </div>
    </UiMobileDrawer>
  </div>
</template>
