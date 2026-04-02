<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useTimelineSettingsStore } from '~/stores/timeline-settings.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import {
  pickBestSnapCandidateUs,
  zoomToPxPerSecond,
  quantizeDeltaUsToFrames,
} from '~/utils/timeline/geometry';
import { computeSnapTargetsUs } from '~/composables/timeline/timelineInteractionUtils';
import type { TimelineClipItem, TimelineTrack } from '~/timeline/types';

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'back'): void;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();
const settingsStore = useTimelineSettingsStore();
const selectionStore = useSelectionStore();
const workspaceStore = useWorkspaceStore();

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
const anchorEdgeUs = ref(0);
const snapTargetsUs = ref<number[]>([]);

function onStart(edge: 'start' | 'end', e: TouchEvent) {
  const touch = e.touches[0];
  if (!touch || !currentClipAndTrack.value) return;

  const clip = currentClipAndTrack.value.item;
  startX.value = touch.clientX;
  activeEdge.value = edge;
  accumulatedDeltaUs.value = 0;
  lastAppliedDeltaUs.value = 0;
  anchorEdgeUs.value =
    edge === 'start'
      ? clip.timelineRange.startUs
      : clip.timelineRange.startUs + clip.timelineRange.durationUs;

  // Compute snap targets
  const snapSettings = workspaceStore.userSettings.timeline.snapping;
  snapTargetsUs.value = computeSnapTargetsUs({
    tracks: timelineStore.timelineDoc?.tracks || [],
    excludeItemId: clip.id,
    includeTimelineStart: snapSettings.timelineEdges,
    includeTimelineEndUs: snapSettings.timelineEdges ? timelineStore.duration : null,
    includePlayheadUs: snapSettings.playhead ? timelineStore.currentTime : null,
    includeMarkers: snapSettings.markers,
    markers: timelineStore.getMarkers(),
    includeClips: snapSettings.clips,
  });

  timelineStore.setCurrentTimeUs(anchorEdgeUs.value);
}

function onMove(e: TouchEvent) {
  if (!activeEdge.value || !currentClipAndTrack.value) return;
  const touch = e.touches[0];
  if (!touch) return;

  const dx = touch.clientX - startX.value;
  const zoom = timelineStore.timelineZoom;
  const pps = zoomToPxPerSecond(zoom);
  const rawDeltaUs = (dx / pps) * 1e6;

  let targetUs = anchorEdgeUs.value + rawDeltaUs;

  // Snapping logic
  if (settingsStore.toolbarSnapMode === 'snap') {
    const thresholdUs = (settingsStore.snapThresholdPx / pps) * 1e6;
    const snap = pickBestSnapCandidateUs({
      rawUs: targetUs,
      thresholdUs,
      targetsUs: snapTargetsUs.value,
    });
    if (snap.distUs < thresholdUs) {
      targetUs = snap.snappedUs;
    }
  }

  // Frame quantization
  const fps = timelineStore.timelineDoc?.timebase?.fps || 30;
  if (settingsStore.frameSnapMode === 'frames') {
    const frames = Math.round((targetUs * fps) / 1e6);
    targetUs = Math.round((frames * 1e6) / fps);
  }

  const desiredTotalDeltaUs = targetUs - anchorEdgeUs.value;
  const diffUs = desiredTotalDeltaUs - lastAppliedDeltaUs.value;

  if (Math.abs(diffUs) >= 1) {
    try {
      timelineStore.trimItem({
        trackId: currentClipAndTrack.value.track.id,
        itemId: currentClipAndTrack.value.item.id,
        edge: activeEdge.value,
        deltaUs: diffUs,
        quantizeToFrames: settingsStore.frameSnapMode === 'frames',
      });

      lastAppliedDeltaUs.value += diffUs;

      const clip = currentClipAndTrack.value.item;
      const nextTimeUs =
        activeEdge.value === 'start'
          ? clip.timelineRange.startUs
          : clip.timelineRange.startUs + clip.timelineRange.durationUs;
      timelineStore.setCurrentTimeUs(nextTimeUs);
    } catch (err) {
      // Ignore
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
    class="fixed bottom-0 left-0 right-0 z-60 bg-zinc-950/95 backdrop-blur border-t border-zinc-900 px-3 pt-3 pb-safe select-none shadow-2xl rounded-t-2xl slide-up outline outline-white/5"
  >
    <!-- Combined control area -->
    <div class="flex items-center gap-2 mb-3">
      <!-- Back to clip properties -->
      <UButton
        icon="i-heroicons-chevron-left"
        variant="ghost"
        color="gray"
        size="md"
        class="shrink-0 bg-white/5 active:bg-white/10"
        @click="emit('back')"
      />

      <!-- Duration visual -->
      <div v-if="currentClipAndTrack" class="flex-1 flex flex-col justify-center items-center py-1">
        <div
          class="text-[10px] text-zinc-500 font-mono tracking-tighter uppercase font-black leading-none mb-0.5"
        >
          {{ (currentClipAndTrack.item.timelineRange.durationUs / 1e6).toFixed(3) }}s
        </div>
        <div
          class="text-[8px] text-zinc-600 uppercase font-black tracking-widest truncate max-w-[140px]"
        >
          {{ currentClipAndTrack.item.name }}
        </div>
      </div>

      <!-- Close and deselect -->
      <UButton
        icon="i-heroicons-x-mark"
        variant="ghost"
        color="gray"
        size="md"
        class="shrink-0 bg-white/5 active:bg-white/10"
        @click="emit('close')"
      />
    </div>

    <!-- Main controls -->
    <div
      class="flex h-20 bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden divide-x divide-zinc-800 shadow-inner mb-2"
    >
      <!-- Left side area -->
      <div
        class="flex-1 flex flex-col items-center justify-center touch-none active:bg-blue-500/10 transition-colors"
        @touchstart="onStart('start', $event)"
        @touchmove="onMove"
        @touchend="onEnd"
      >
        <span class="text-[9px] uppercase font-black text-zinc-600 mb-1 leading-none">
          {{ t('fastcat.timeline.trimStart') }}
        </span>
        <div class="bg-zinc-800 p-1.5 rounded-lg border border-zinc-700/50">
          <UIcon
            name="i-heroicons-arrow-left"
            class="w-5 h-5 block"
            :class="activeEdge === 'start' ? 'text-blue-400' : 'text-zinc-500'"
          />
        </div>
      </div>

      <!-- Center divider marker -->
      <div class="w-px h-8 self-center bg-zinc-800/10"></div>

      <!-- Right side area -->
      <div
        class="flex-1 flex flex-col items-center justify-center touch-none active:bg-blue-500/10 transition-colors"
        @touchstart="onStart('end', $event)"
        @touchmove="onMove"
        @touchend="onEnd"
      >
        <span class="text-[9px] uppercase font-black text-zinc-600 mb-1 leading-none">
          {{ t('fastcat.timeline.trimEnd') }}
        </span>
        <div class="bg-zinc-800 p-1.5 rounded-lg border border-zinc-700/50">
          <UIcon
            name="i-heroicons-arrow-right"
            class="w-5 h-5 block"
            :class="activeEdge === 'end' ? 'text-blue-400' : 'text-zinc-500'"
          />
        </div>
      </div>
    </div>
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
