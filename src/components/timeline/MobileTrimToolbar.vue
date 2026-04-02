<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useTimelineSettingsStore } from '~/stores/timeline-settings.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import {
  pickBestSnapCandidateUs,
  zoomToPxPerSecond,
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

const fps = computed(() => timelineStore.timelineDoc?.timebase?.fps || 30);

function formatTC(us: number) {
  const absUs = Math.abs(us);
  const totalFrames = Math.round((absUs / 1_000_000) * fps.value);
  const ff = totalFrames % fps.value;
  const totalSeconds = Math.floor(absUs / 1_000_000);
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);

  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`;
}

const timeData = computed(() => {
  if (!currentClipAndTrack.value) return null;
  const clip = currentClipAndTrack.value.item;
  const s = clip.timelineRange.startUs;
  const d = clip.timelineRange.durationUs;
  return {
    start: formatTC(s),
    duration: formatTC(d),
    end: formatTC(s + d),
  };
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

  if (settingsStore.frameSnapMode === 'frames') {
    const frameSizeUs = 1_000_000 / fps.value;
    targetUs = Math.round(targetUs / frameSizeUs) * frameSizeUs;
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
    class="fixed bottom-0 left-0 right-0 z-60 bg-zinc-950/95 backdrop-blur border-t border-zinc-900 px-2 pt-3 pb-safe select-none shadow-2xl rounded-t-2xl slide-up outline outline-white/5"
  >
    <!-- Combined control area -->
    <div class="flex items-center gap-1 mb-3 px-1">
      <!-- Back button -->
      <UButton
        icon="i-heroicons-chevron-left"
        variant="ghost"
        color="gray"
        size="sm"
        class="shrink-0 bg-white/5 active:bg-white/10"
        @click="emit('back')"
      />

      <!-- Triple Info View -->
      <div v-if="timeData" class="flex-1 flex justify-between items-center px-2">
        <div class="flex flex-col items-center">
          <span class="text-[7px] text-zinc-500 uppercase font-black leading-none mb-1 tracking-tighter">
             {{ t('fastcat.timeline.start') }}
          </span>
          <span class="text-[10px] font-mono font-bold text-zinc-400 tabular-nums leading-none">
            {{ timeData.start }}
          </span>
        </div>

        <div class="w-px h-6 bg-zinc-800/60"></div>

        <div class="flex flex-col items-center">
          <span class="text-[7px] text-zinc-500 uppercase font-black leading-none mb-1 tracking-tighter">
             {{ t('fastcat.timeline.duration') }}
          </span>
          <span class="text-[10px] font-mono font-bold text-blue-400 tabular-nums leading-none">
            {{ timeData.duration }}
          </span>
        </div>

        <div class="w-px h-6 bg-zinc-800/60"></div>

        <div class="flex flex-col items-center">
          <span class="text-[7px] text-zinc-500 uppercase font-black leading-none mb-1 tracking-tighter">
             {{ t('fastcat.timeline.end') }}
          </span>
          <span class="text-[10px] font-mono font-bold text-zinc-400 tabular-nums leading-none">
            {{ timeData.end }}
          </span>
        </div>
      </div>

      <!-- Close and deselect -->
      <UButton
        icon="i-heroicons-x-mark"
        variant="ghost"
        color="gray"
        size="sm"
        class="shrink-0 bg-white/5 active:bg-white/10"
        @click="emit('close')"
      />
    </div>

    <!-- Main controls -->
    <div
      class="flex h-20 bg-zinc-900/60 rounded-xl border border-zinc-800/80 overflow-hidden divide-x divide-zinc-800 shadow-inner mb-2"
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
        <div class="bg-zinc-800 p-1.5 rounded-lg border border-zinc-700/50 shadow-sm">
          <UIcon
            name="i-heroicons-arrow-left"
            class="w-5 h-5 block"
            :class="activeEdge === 'start' ? 'text-blue-400 scale-110' : 'text-zinc-500'"
          />
        </div>
      </div>

      <!-- Center divider marker -->
      <div class="w-px h-10 self-center bg-zinc-800/20"></div>

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
        <div class="bg-zinc-800 p-1.5 rounded-lg border border-zinc-700/50 shadow-sm">
          <UIcon
            name="i-heroicons-arrow-right"
            class="w-5 h-5 block"
            :class="activeEdge === 'end' ? 'text-blue-400 scale-110' : 'text-zinc-500'"
          />
        </div>
      </div>
    </div>

    <!-- Hidden Hint: Clip name at the very bottom -->
    <div v-if="currentClipAndTrack" class="px-2 pb-1 flex justify-center">
       <span class="text-[8px] text-zinc-700 uppercase font-bold tracking-[0.2em] truncate">
         {{ currentClipAndTrack.item.name }}
       </span>
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
.tabular-nums {
  font-variant-numeric: tabular-nums;
}
</style>
