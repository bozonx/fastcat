<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import type { TimelineClipItem, TimelineTrack } from '~/timeline/types';

const props = defineProps<{
  trimPreview?: {
    itemId: string;
    trackId: string;
    startUs: number;
    durationUs: number;
    edge: 'start' | 'end';
  } | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'back'): void;
  (
    e: 'trim-start',
    payload: {
      trackId: string;
      itemId: string;
      edge: 'start' | 'end';
      clientX: number;
      clientY: number;
    },
  ): void;
  (e: 'trim-move', payload: { clientX: number; clientY: number }): void;
  (e: 'trim-end', payload: { clientX: number; clientY: number }): void;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();
const selectionStore = useSelectionStore();

const activeEdge = ref<'start' | 'end' | null>(null);

const currentClipAndTrack = computed(() => {
  const entity = selectionStore.selectedEntity;
  if (entity?.source !== 'timeline' || entity.kind !== 'clip') return null;

  const track = timelineStore.timelineDoc?.tracks?.find((item) => item.id === entity.trackId) as
    | TimelineTrack
    | undefined;
  if (!track) return null;

  const item = track.items.find((clip) => clip.id === entity.itemId) as
    | TimelineClipItem
    | undefined;
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

const effectiveRange = computed(() => {
  const clipContext = currentClipAndTrack.value;
  if (!clipContext) return null;

  if (
    props.trimPreview &&
    props.trimPreview.itemId === clipContext.item.id &&
    props.trimPreview.trackId === clipContext.track.id
  ) {
    return {
      startUs: props.trimPreview.startUs,
      durationUs: props.trimPreview.durationUs,
    };
  }

  return {
    startUs: clipContext.item.timelineRange.startUs,
    durationUs: clipContext.item.timelineRange.durationUs,
  };
});

const timeData = computed(() => {
  if (!effectiveRange.value) return null;
  const startUs = effectiveRange.value.startUs;
  const durationUs = effectiveRange.value.durationUs;

  return {
    start: formatTC(startUs),
    duration: formatTC(durationUs),
    end: formatTC(startUs + durationUs),
  };
});

function getTouchPoint(event: TouchEvent): { clientX: number; clientY: number } | null {
  const touch = event.touches[0] ?? event.changedTouches[0];
  if (!touch) return null;
  return { clientX: touch.clientX, clientY: touch.clientY };
}

function onStart(edge: 'start' | 'end', event: TouchEvent) {
  const clipContext = currentClipAndTrack.value;
  const touch = getTouchPoint(event);
  if (!clipContext || !touch) return;

  event.preventDefault();
  activeEdge.value = edge;
  emit('trim-start', {
    trackId: clipContext.track.id,
    itemId: clipContext.item.id,
    edge,
    clientX: touch.clientX,
    clientY: touch.clientY,
  });
}

function onMove(event: TouchEvent) {
  if (!activeEdge.value) return;
  const touch = getTouchPoint(event);
  if (!touch) return;

  event.preventDefault();
  emit('trim-move', touch);
}

function onEnd(event: TouchEvent) {
  if (!activeEdge.value) return;
  const touch = getTouchPoint(event);
  activeEdge.value = null;
  if (!touch) return;

  event.preventDefault();
  emit('trim-end', touch);
}
</script>

<template>
  <div
    class="fixed bottom-0 left-0 right-0 z-60 bg-zinc-950/95 backdrop-blur border-t border-zinc-900 px-2 pt-3 pb-safe select-none shadow-2xl rounded-t-2xl slide-up outline outline-white/5"
  >
    <div class="flex items-center gap-1 mb-3 px-1">
      <UButton
        icon="i-heroicons-chevron-left"
        variant="ghost"
        color="gray"
        size="sm"
        class="shrink-0 bg-white/5 active:bg-white/10"
        @click="emit('back')"
      />

      <div v-if="timeData" class="flex-1 flex justify-between items-center px-2">
        <div class="flex flex-col items-center">
          <span
            class="text-[7px] text-zinc-500 uppercase font-black leading-none mb-1 tracking-tighter"
          >
            {{ t('fastcat.timeline.start') }}
          </span>
          <span class="text-[10px] font-mono font-bold text-zinc-400 tabular-nums leading-none">
            {{ timeData.start }}
          </span>
        </div>

        <div class="w-px h-6 bg-zinc-800/60"></div>

        <div class="flex flex-col items-center">
          <span
            class="text-[7px] text-zinc-500 uppercase font-black leading-none mb-1 tracking-tighter"
          >
            {{ t('fastcat.timeline.duration') }}
          </span>
          <span class="text-[10px] font-mono font-bold text-blue-400 tabular-nums leading-none">
            {{ timeData.duration }}
          </span>
        </div>

        <div class="w-px h-6 bg-zinc-800/60"></div>

        <div class="flex flex-col items-center">
          <span
            class="text-[7px] text-zinc-500 uppercase font-black leading-none mb-1 tracking-tighter"
          >
            {{ t('fastcat.timeline.end') }}
          </span>
          <span class="text-[10px] font-mono font-bold text-zinc-400 tabular-nums leading-none">
            {{ timeData.end }}
          </span>
        </div>
      </div>

      <UButton
        icon="i-heroicons-x-mark"
        variant="ghost"
        color="gray"
        size="sm"
        class="shrink-0 bg-white/5 active:bg-white/10"
        @click="emit('close')"
      />
    </div>

    <div
      class="flex h-20 bg-zinc-900/60 rounded-xl border border-zinc-800/80 overflow-hidden divide-x divide-zinc-800 shadow-inner mb-2"
    >
      <div
        class="flex-1 flex flex-col items-center justify-center touch-none active:bg-blue-500/10 transition-colors"
        @touchstart="onStart('start', $event)"
        @touchmove="onMove"
        @touchend="onEnd"
        @touchcancel="onEnd"
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

      <div class="w-px h-10 self-center bg-zinc-800/20"></div>

      <div
        class="flex-1 flex flex-col items-center justify-center touch-none active:bg-blue-500/10 transition-colors"
        @touchstart="onStart('end', $event)"
        @touchmove="onMove"
        @touchend="onEnd"
        @touchcancel="onEnd"
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

    <div v-if="currentClipAndTrack" class="px-2 pb-1 flex justify-center">
      <span class="text-[8px] text-zinc-700 uppercase font-bold tracking-[0.2em] truncate">
        {{ currentClipAndTrack.item.name }}
      </span>
    </div>
  </div>
</template>
