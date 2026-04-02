<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import type { TimelineClipItem, TimelineTrack } from '~/timeline/types';
import MobileTimelineDrawer from './MobileTimelineDrawer.vue';

const props = defineProps<{
  isOpen: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();
const selectionStore = useSelectionStore();

const isOpenLocal = computed({
  get: () => props.isOpen,
  set: (val) => {
    if (!val) emit('close');
  },
});

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

const clip = computed(() => currentClipAndTrack.value?.item);
const track = computed(() => currentClipAndTrack.value?.track);

const startX = ref(0);
const activeEdge = ref<'start' | 'end' | null>(null);
const accumulatedDeltaUs = ref(0);
const lastAppliedDeltaUs = ref(0);

// For visual "ribbon" animation
const ribbonOffset = ref({ start: 0, end: 0 });

function onStart(edge: 'start' | 'end', e: TouchEvent) {
  const touch = e.touches[0];
  if (!touch) return;
  startX.value = touch.clientX;
  activeEdge.value = edge;
  accumulatedDeltaUs.value = 0;
  lastAppliedDeltaUs.value = 0;

  // Jump playhead to the edge for visual feedback
  if (clip.value) {
    const timeUs =
      edge === 'start'
        ? clip.value.timelineRange.startUs
        : clip.value.timelineRange.startUs + clip.value.timelineRange.durationUs;
    timelineStore.setCurrentTimeUs(timeUs);
  }
}

function onMove(e: TouchEvent) {
  if (!activeEdge.value || !clip.value || !track.value) return;
  const touch = e.touches[0];
  if (!touch) return;

  const dx = touch.clientX - startX.value;

  // Sensitivity: adjust for zoom? Or just fixed.
  // Using zoom-aware sensitivity for premium feel
  // Higher zoom = smaller steps. Lower zoom = bigger steps.
  // Zoom is typically 0-100.
  const zoomFactor = Math.max(1, (100 - timelineStore.timelineZoom) / 10);
  const deltaUs = dx * 10000 * zoomFactor;

  accumulatedDeltaUs.value = deltaUs;
  ribbonOffset.value[activeEdge.value] = dx;

  // Apply delta differentially
  const diffUs = accumulatedDeltaUs.value - lastAppliedDeltaUs.value;

  if (Math.abs(diffUs) > 1000) {
    // Apply every 1ms change
    try {
      timelineStore.trimItem({
        trackId: track.value.id,
        itemId: clip.value.id,
        edge: activeEdge.value,
        deltaUs: diffUs,
        quantizeToFrames: true, // This will handle snapping to frames internally
      });

      lastAppliedDeltaUs.value = accumulatedDeltaUs.value;

      // Update playhead to follow the edge
      const nextTimeUs =
        activeEdge.value === 'start'
          ? clip.value.timelineRange.startUs
          : clip.value.timelineRange.startUs + clip.value.timelineRange.durationUs;
      timelineStore.setCurrentTimeUs(nextTimeUs);

      // Web Vibration API for haptics if available
      if ('vibrate' in navigator) {
        // navigator.vibrate(1); // Very subtle. Might be annoying during fluid drag.
      }
    } catch (err) {
      // Ignore trim errors during drag (e.g. hitting limit)
    }
  }
}

function onEnd() {
  activeEdge.value = null;
  ribbonOffset.value.start = 0;
  ribbonOffset.value.end = 0;
  timelineStore.requestTimelineSave({ immediate: true });
}

function close() {
  emit('close');
}
</script>

<template>
  <MobileTimelineDrawer v-model:open="isOpenLocal" force-landscape-direction="bottom">
    <template #header>
      <div class="flex items-center gap-2">
        <div class="w-7 h-7 rounded bg-blue-500/20 flex items-center justify-center shrink-0">
          <UIcon name="i-heroicons-arrows-right-left" class="w-4 h-4 text-blue-400" />
        </div>
        <div class="flex flex-col">
          <span class="text-sm font-bold text-zinc-200 leading-none">
            {{ t('fastcat.timeline.trimMode') }}
          </span>
          <span v-if="clip" class="text-[10px] text-zinc-500 mt-1 uppercase tracking-tighter">
            {{ clip.name }} | {{ (clip.timelineRange.durationUs / 1e6).toFixed(2) }}s
          </span>
        </div>
      </div>
    </template>

    <div class="px-4 py-8">
      <div
        class="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl overflow-hidden shadow-inner"
      >
        <div class="flex h-44 divide-x divide-zinc-800/80">
          <!-- Start Area -->
          <div
            class="flex-1 flex flex-col items-center justify-center gap-3 touch-none select-none relative transition-colors"
            @touchstart="onStart('start', $event)"
            @touchmove="onMove"
            @touchend="onEnd"
          >
            <div
              class="absolute inset-0 bg-blue-500/5 transition-opacity duration-300"
              :class="activeEdge === 'start' ? 'opacity-100' : 'opacity-0 pointer-events-none'"
            ></div>

            <UIcon
              name="i-heroicons-arrow-left-20-solid"
              class="w-5 h-5 transition-transform"
              :class="activeEdge === 'start' ? 'text-blue-400 scale-125' : 'text-zinc-600'"
            />

            <div class="flex flex-col items-center">
              <span class="text-[10px] uppercase tracking-[0.2em] font-black text-zinc-500">
                {{ t('fastcat.timeline.trimStart') }}
              </span>
            </div>

            <!-- Visual Scrubber Ribbon -->
            <div class="w-full flex justify-center gap-2 overflow-hidden px-4">
              <div
                class="flex gap-2 transition-transform duration-75 ease-out"
                :style="{ transform: `translateX(${ribbonOffset.start}px)` }"
              >
                <div
                  v-for="i in 15"
                  :key="i"
                  class="w-0.5 rounded-full transition-colors"
                  :class="[
                    i % 5 === 0 ? 'h-6' : 'h-3',
                    activeEdge === 'start' ? 'bg-blue-400/40' : 'bg-zinc-700/30',
                  ]"
                ></div>
              </div>
            </div>
          </div>

          <!-- End Area -->
          <div
            class="flex-1 flex flex-col items-center justify-center gap-3 touch-none select-none relative transition-colors"
            @touchstart="onStart('end', $event)"
            @touchmove="onMove"
            @touchend="onEnd"
          >
            <div
              class="absolute inset-0 bg-blue-500/5 transition-opacity duration-300"
              :class="activeEdge === 'end' ? 'opacity-100' : 'opacity-0 pointer-events-none'"
            ></div>

            <UIcon
              name="i-heroicons-arrow-right-20-solid"
              class="w-5 h-5 transition-transform"
              :class="activeEdge === 'end' ? 'text-blue-400 scale-125' : 'text-zinc-600'"
            />

            <div class="flex flex-col items-center">
              <span class="text-[10px] uppercase tracking-[0.2em] font-black text-zinc-500">
                {{ t('fastcat.timeline.trimEnd') }}
              </span>
            </div>

            <!-- Visual Scrubber Ribbon -->
            <div class="w-full flex justify-center gap-2 overflow-hidden px-4">
              <div
                class="flex gap-2 transition-transform duration-75 ease-out"
                :style="{ transform: `translateX(${ribbonOffset.end}px)` }"
              >
                <div
                  v-for="i in 15"
                  :key="i"
                  class="w-0.5 rounded-full transition-colors"
                  :class="[
                    i % 5 === 0 ? 'h-6' : 'h-3',
                    activeEdge === 'end' ? 'bg-blue-400/40' : 'bg-zinc-700/30',
                  ]"
                ></div>
              </div>
            </div>
          </div>
        </div>

        <!-- Hint -->
        <div
          class="bg-zinc-900 border-t border-zinc-800/80 py-2 px-4 flex justify-center items-center gap-2"
        >
          <UIcon name="i-heroicons-hand-raised" class="w-3.5 h-3.5 text-zinc-600" />
          <span class="text-[10px] text-zinc-500 font-medium uppercase tracking-widest">
            {{ t('fastcat.timeline.trimHint') }}
          </span>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex gap-3">
        <button
          class="flex-1 bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-200 py-3 rounded-xl font-bold text-sm transition-all shadow-lg active:scale-95"
          @click="close"
        >
          {{ t('common.done') }}
        </button>
      </div>
    </template>
  </MobileTimelineDrawer>
</template>

<style scoped>
.touch-none {
  touch-action: none;
}
</style>
