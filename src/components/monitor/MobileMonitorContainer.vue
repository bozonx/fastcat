<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProxyStore } from '~/stores/proxy.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useUiStore } from '~/stores/ui.store';
import { useMonitorTimeline } from '~/composables/monitor/useMonitorTimeline';
import { useMonitorDisplay } from '~/composables/monitor/useMonitorDisplay';
import { useMonitorPlayback } from '~/composables/monitor/useMonitorPlayback';
import { useMonitorCore } from '~/composables/monitor/useMonitorCore';
import { useMonitorGrid } from '~/composables/monitor/useMonitorGrid';
import { useMonitorSnapshot } from '~/composables/monitor/useMonitorSnapshot';
import MonitorTextTransformBox from './MonitorTextTransformBox.vue';
import MonitorViewport from './MonitorViewport.vue';
import MonitorTransformBox from './MonitorTransformBox.vue';

const props = withDefaults(
  defineProps<{
    mode?: 'edit' | 'sound';
  }>(),
  {
    mode: 'edit',
  },
);

const { t } = useI18n();
const projectStore = useProjectStore();
const timelineStore = useTimelineStore();
const proxyStore = useProxyStore();
const workspaceStore = useWorkspaceStore();
const selectionStore = useSelectionStore();
const uiStore = useUiStore();
const { isPlaying, currentTime, duration } = storeToRefs(timelineStore);

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
const viewportEl = computed(() => (viewportRef.value?.viewportEl as HTMLDivElement | null) ?? null);

const {
  isLoading,
  loadError,
  scheduleRender,
  scheduleBuild,
  clampToTimeline,
  updateStoreTime,
  audioEngine,
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

const containerHeightClass = computed(() =>
  props.mode === 'sound' ? 'h-[30vh] min-h-[220px] max-h-[340px]' : 'h-[34vh] min-h-[240px] max-h-[420px]',
);

const statusText = computed(() => {
  if (loadError.value) return 'Preview failed';
  if (isLoading.value) return 'Preparing preview';
  if (videoItems.value.length === 0) return 'Add media to preview it here';
  return props.mode === 'sound' ? 'Sound view' : 'Preview';
});

function blurActiveElement() {
  (document.activeElement as HTMLElement | null)?.blur?.();
}

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

const { showGrid, getGridLines } = useMonitorGrid({ projectStore });
const isReadonly = computed(
  () => projectStore.currentView === 'sound' || projectStore.currentView === 'export',
);

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

const { saveTimelineThumbnail } = useMonitorSnapshot({
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
</script>

<template>
  <div
    class="flex min-w-0 shrink-0 flex-col border-b border-ui-border bg-ui-bg-elevated"
    :class="containerHeightClass"
  >
    <!-- Video area -->
    <MonitorViewport ref="viewportRef" :render-width="renderWidth" :render-height="renderHeight" class="bg-black/80">
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
          v-else-if="isLoading"
          class="absolute inset-0 flex flex-col items-center justify-center gap-3 text-ui-text-muted"
        >
          <UIcon name="lucide:loader-2" class="w-8 h-8 animate-spin" />
          <p class="text-sm">{{ statusText }}</p>
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

    <!-- Playback controls -->
    <div class="shrink-0 border-t border-ui-border bg-ui-bg px-4 py-2.5">
      <div class="mb-2 flex items-center justify-between gap-3 text-[11px] text-ui-text-muted">
        <span class="uppercase tracking-[0.18em]">{{ props.mode === 'sound' ? 'Monitor' : 'Preview' }}</span>
        <span class="truncate">{{ statusText }}</span>
      </div>
      <div class="flex items-center justify-between gap-3">
        <span ref="timecodeEl" class="min-w-0 text-xs font-mono tabular-nums text-ui-text">
          00:00:00:00 / 00:00:00:00
        </span>
        <div class="flex items-center gap-2">
          <UButton
            size="md"
            variant="ghost"
            color="neutral"
            icon="lucide:skip-back"
            :aria-label="t('granVideoEditor.monitor.rewind', 'Rewind')"
            :disabled="!canInteractPlayback"
            @click="rewindToStart"
          />
          <UButton
            size="md"
            variant="solid"
            color="primary"
            :icon="timelineStore.isPlaying ? 'lucide:pause' : 'lucide:play'"
            :aria-label="t('granVideoEditor.monitor.play', 'Play')"
            :disabled="!canInteractPlayback"
            @click="togglePlayback"
          />
        </div>
      </div>
    </div>
  </div>
</template>
