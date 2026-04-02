<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import type { TimelineClipItem, TimelineTrack } from '~/timeline/types';

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();
const selectionStore = useSelectionStore();

const currentClipAndTrack = computed(() => {
  const entity = selectionStore.selectedEntity;
  if (entity?.source !== 'timeline' || entity.kind !== 'clip') return null;
  const trackId = entity.trackId;
  const itemId = entity.itemId;

  const track = timelineStore.timelineDoc?.tracks?.find((t) => t.id === trackId) as
    | TimelineTrack
    | undefined;
  if (!track) return null;
  const item = track.items.find((i) => i.id === itemId) as TimelineClipItem | undefined;
  if (!item || item.kind !== 'clip') return null;
  return { track, item };
});

const startX = ref(0);
const activeEdge = ref<'start' | 'end' | null>(null);
const accumulatedDeltaUs = ref(0);
const lastAppliedDeltaUs = ref(0);

function onStart(edge: 'start' | 'end', e: TouchEvent) {
  const touch = e.touches[0];
  if (!touch) return;
  startX.value = touch.clientX;
  activeEdge.value = edge;
  accumulatedDeltaUs.value = 0;
  lastAppliedDeltaUs.value = 0;

  if (currentClipAndTrack.value?.item) {
    const clip = currentClipAndTrack.value.item;
    const timeUs =
      edge === 'start'
        ? clip.timelineRange.startUs
        : clip.timelineRange.startUs + clip.timelineRange.durationUs;
    timelineStore.setCurrentTimeUs(timeUs);
  }
}

function onMove(e: TouchEvent) {
  if (!activeEdge.value || !currentClipAndTrack.value) return;
  const touch = e.touches[0];
  if (!touch) return;

  const dx = touch.clientX - startX.value;
  const zoomFactor = Math.max(1, (100 - timelineStore.timelineZoom) / 10);
  const deltaUs = dx * 8000 * zoomFactor;

  accumulatedDeltaUs.value = deltaUs;
  const diffUs = accumulatedDeltaUs.value - lastAppliedDeltaUs.value;

  if (Math.abs(diffUs) > 1000) {
    try {
      timelineStore.trimItem({
        trackId: currentClipAndTrack.value.track.id,
        itemId: currentClipAndTrack.value.item.id,
        edge: activeEdge.value,
        deltaUs: diffUs,
        quantizeToFrames: true,
      });

      lastAppliedDeltaUs.value = accumulatedDeltaUs.value;

      const clip = currentClipAndTrack.value.item;
      const nextTimeUs =
        activeEdge.value === 'start'
          ? clip.timelineRange.startUs
          : clip.timelineRange.startUs + clip.timelineRange.durationUs;
      timelineStore.setCurrentTimeUs(nextTimeUs);
    } catch (err) {
      // Ignore trim errors during drag
    }
  }
}

function onEnd() {
  activeEdge.value = null;
  timelineStore.requestTimelineSave({ immediate: true });
}
</script>

<template>
  <div
    class="fixed bottom-0 left-0 right-0 z-60 bg-zinc-950 border-t border-zinc-800 px-4 pt-3 pb-safe select-none shadow-2xl rounded-t-2xl slide-up outline outline-white/5"
  >
    <!-- Header/Title -->
    <div class="flex items-center justify-between mb-3 px-1">
      <div class="flex items-center gap-2">
        <div class="bg-blue-500/20 p-1.5 rounded-lg">
          <UIcon name="i-heroicons-arrows-right-left" class="text-blue-400 w-4 h-4 block" />
        </div>
        <div>
          <div class="text-[10px] uppercase tracking-widest text-zinc-500 font-black leading-none">
            {{ t('fastcat.timeline.trimMode') }}
          </div>
          <div v-if="currentClipAndTrack" class="text-xs text-zinc-200 font-bold mt-0.5 truncate max-w-[200px]">
             {{ currentClipAndTrack.item.name }}
          </div>
        </div>
      </div>

      <UButton
        icon="i-heroicons-x-mark"
        variant="ghost"
        color="gray"
        size="sm"
        @click="emit('close')"
      />
    </div>

    <!-- Main controls -->
    <div
      class="flex h-20 bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden divide-x divide-zinc-800 shadow-inner"
    >
      <!-- Left side area -->
      <div
        class="flex-1 flex flex-col items-center justify-center touch-none active:bg-blue-500/10 transition-colors"
        @touchstart="onStart('start', $event)"
        @touchmove="onMove"
        @touchend="onEnd"
      >
        <span class="text-[9px] uppercase font-black text-zinc-500 mb-1 leading-none">
          {{ t('fastcat.timeline.trimStart') }}
        </span>
        <UIcon
          name="i-heroicons-chevron-left"
          class="w-6 h-6"
          :class="activeEdge === 'start' ? 'text-blue-400 scale-125' : 'text-zinc-600'"
        />
      </div>

      <!-- Center info -->
      <div class="px-5 flex flex-col justify-center items-center bg-zinc-950/40 min-w-[100px]">
        <div class="text-[10px] text-zinc-500 uppercase font-black mb-1 leading-none">Duration</div>
        <div class="text-sm text-blue-400 font-mono font-bold tracking-tighter">
          {{
            currentClipAndTrack
              ? (currentClipAndTrack.item.timelineRange.durationUs / 1e6).toFixed(3) + 's'
              : '-'
          }}
        </div>
      </div>

      <!-- Right side area -->
      <div
        class="flex-1 flex flex-col items-center justify-center touch-none active:bg-blue-500/10 transition-colors"
        @touchstart="onStart('end', $event)"
        @touchmove="onMove"
        @touchend="onEnd"
      >
        <span class="text-[9px] uppercase font-black text-zinc-500 mb-1 leading-none">
          {{ t('fastcat.timeline.trimEnd') }}
        </span>
        <UIcon
          name="i-heroicons-chevron-right"
          class="w-6 h-6"
          :class="activeEdge === 'end' ? 'text-blue-400 scale-125' : 'text-zinc-600'"
        />
      </div>
    </div>

    <!-- Bottom spacing for safe area -->
    <div class="h-2"></div>
  </div>
</template>

<style scoped>
.slide-up {
  animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes slideUp {
  from {
    transform: translateY(100%);
  }
  to {
    transform: translateY(0);
  }
}
.touch-none {
  touch-action: none;
}
</style>
