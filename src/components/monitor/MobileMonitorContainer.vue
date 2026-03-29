<script setup lang="ts">
import { computed, ref, nextTick, watch, watchEffect } from 'vue';
import { storeToRefs } from 'pinia';
import { useFullscreen, useMediaQuery } from '@vueuse/core';
import { useMonitorGrid } from '~/composables/monitor/useMonitorGrid';
import { useMonitorRuntime } from '~/composables/monitor/useMonitorRuntime';
import MonitorTextTransformBox from './MonitorTextTransformBox.vue';
import MonitorViewport from './MonitorViewport.vue';
import MonitorTransformBox from './MonitorTransformBox.vue';
import MonitorAudioControl from './MonitorAudioControl.vue';
import { useMonitorContainerControls } from '~/composables/monitor/useMonitorContainerControls';
import type { TimelineMarker } from '~/timeline/types';

const props = withDefaults(
  defineProps<{
    mode?: 'edit' | 'sound';
  }>(),
  {
    mode: 'edit',
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

const monitorZoomLabel = computed(() => {
  const zoom = projectStore.activeMonitor?.zoom ?? 1;
  return `x${zoom.toFixed(2)}`;
});

const containerRef = ref<HTMLElement | null>(null);
const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(containerRef);

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

const showSideControls = computed(() => !isFullscreen.value && (isLandscape.value || isVerticalProject.value));

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

const containerHeightClass = computed(() =>
  props.mode === 'sound'
    ? 'h-[30vh] min-h-[220px] max-h-[340px]'
    : 'h-[34vh] min-h-[240px] max-h-[420px]',
);
</script>

<template>
  <div
    ref="containerRef"
    class="flex min-w-0 shrink-0 border-ui-border bg-ui-bg-elevated transition-colors duration-200"
    :class="[
      isFullscreen ? 'fixed inset-0 z-50 h-screen w-screen flex-col' : [containerHeightClass, showSideControls ? 'flex-row border-r' : 'flex-col border-b'],
    ]"
  >
    <!-- Video area -->
    <MonitorViewport
      ref="viewportRef"
      :render-width="renderWidth"
      :render-height="renderHeight"
      :effective-fullscreen="isFullscreen"
      :ui-current-time-us="uiCurrentTimeUs"
      class="bg-black/80"
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
          ? 'w-[72px] flex flex-col items-center py-4 border-l border-ui-border'
          : 'px-4 py-2 border-t border-ui-border',
      ]"
    >
      <div
        class="flex gap-3"
        :class="[
          showSideControls ? 'flex-col justify-between h-full items-center' : 'items-center justify-between',
        ]"
      >
        <div
          class="flex items-center gap-1.5 overflow-x-auto no-scrollbar"
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
            :color="useProxyInMonitor ? 'primary' : 'neutral'"
            icon="i-heroicons-bolt"
            class="p-1.5"
            @click="toggleProxyUsage"
          />

          <UButton
            size="xs"
            variant="ghost"
            :color="previewEffectsEnabled ? 'primary' : 'neutral'"
            icon="i-heroicons-sparkles"
            class="p-1.5"
            @click="togglePreviewEffects"
          />

          <UButton
            size="xs"
            variant="ghost"
            color="neutral"
            class="font-mono tabular-nums text-[10px] min-w-10 justify-center h-6 px-1 text-ui-text-muted hover:text-ui-text"
            :label="monitorZoomLabel"
            @click="resetZoom"
          />
        </div>

        <!-- Right/Bottom cluster: Volume, Rewind, Play, Menu -->
        <div
          class="flex items-center gap-1"
          :class="[showSideControls ? 'flex-col' : '']"
        >
          <MonitorAudioControl :compact="true" />

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
            size="md"
            variant="ghost"
            color="primary"
            :icon="timelineStore.isPlaying ? 'lucide:pause' : 'lucide:play'"
            class="p-1"
            :aria-label="t('fastcat.monitor.play', 'Play')"
            :disabled="!canInteractPlayback"
            @click="togglePlayback"
          />

          <UDropdownMenu :items="contextMenuItems">
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
  </div>
</template>
