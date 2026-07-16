<script setup lang="ts">
import { ref } from 'vue';
import { useSelectedTimelineClip } from '~/composables/timeline/useSelectedTimelineClip';

defineProps<{
  trimPreview?:
    | {
        itemId: string;
        trackId: string;
        startTicks: number;
        durationTicks: number;
        edge: 'start' | 'end';
      }[]
    | null;
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

const activeEdge = ref<'start' | 'end' | null>(null);

const { clipAndTrack: currentClipAndTrack } = useSelectedTimelineClip();

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
    class="fixed bottom-0 left-0 right-0 z-60 bg-ui-bg/95 backdrop-blur border-t border-ui-border px-3 pt-3 pb-safe select-none shadow-2xl rounded-t-2xl outline outline-white/5"
  >
    <!-- Header -->
    <div class="flex items-center justify-between mb-3 px-1">
      <UButton
        icon="i-heroicons-chevron-left"
        variant="ghost"
        color="gray"
        size="sm"
        class="shrink-0 bg-white/5 active:bg-white/10"
        @click="emit('back')"
      />

      <span class="text-xs font-bold text-ui-text uppercase tracking-wider">
        {{ t('fastcat.timeline.manualTrim') }}
      </span>

      <UButton
        icon="i-heroicons-x-mark"
        variant="ghost"
        color="gray"
        size="sm"
        class="shrink-0 bg-white/5 active:bg-white/10"
        @click="emit('close')"
      />
    </div>

    <!-- Manual trim -->
    <div
      class="flex h-16 bg-ui-bg-elevated/60 rounded-xl border border-ui-border/80 overflow-hidden divide-x divide-ui-border shadow-inner mb-2"
    >
      <div
        class="flex-1 flex flex-col items-center justify-center touch-none active:bg-blue-500/10 transition-colors"
        @touchstart="onStart('start', $event)"
        @touchmove="onMove"
        @touchend="onEnd"
        @touchcancel="onEnd"
      >
        <span class="text-[9px] uppercase font-black text-ui-text-muted mb-1 leading-none">
          {{ t('fastcat.timeline.trimStart') }}
        </span>
        <div class="bg-ui-bg-muted p-1.5 rounded-lg border border-ui-border/50 shadow-sm">
          <UIcon
            name="i-heroicons-arrow-left"
            class="w-5 h-5 block"
            :class="activeEdge === 'start' ? 'text-blue-400 scale-110' : 'text-ui-text-muted'"
          />
        </div>
      </div>

      <div class="w-px h-10 self-center bg-ui-border/20"></div>

      <div
        class="flex-1 flex flex-col items-center justify-center touch-none active:bg-blue-500/10 transition-colors"
        @touchstart="onStart('end', $event)"
        @touchmove="onMove"
        @touchend="onEnd"
        @touchcancel="onEnd"
      >
        <span class="text-[9px] uppercase font-black text-ui-text-muted mb-1 leading-none">
          {{ t('fastcat.timeline.trimEnd') }}
        </span>
        <div class="bg-ui-bg-muted p-1.5 rounded-lg border border-ui-border/50 shadow-sm">
          <UIcon
            name="i-heroicons-arrow-right"
            class="w-5 h-5 block"
            :class="activeEdge === 'end' ? 'text-blue-400 scale-110' : 'text-ui-text-muted'"
          />
        </div>
      </div>
    </div>
  </div>
</template>
