<script setup lang="ts">
import { computed } from 'vue';
import type { TimelineTrack, TimelineClipItem, TimelineTrackItem } from '~/timeline/types';
import { timeUsToPx } from '~/utils/timeline/geometry';
import { CLIP_AUDIO_GAIN_MAX } from '~/utils/audio/envelope';

const props = defineProps<{
  clip: TimelineClipItem;
  item: TimelineTrackItem;
  track: TimelineTrack;
  zoom: number;
  clipWidthPx: number;
  canEdit: boolean;
  isDragging?: boolean;
  isResizingVolume?: boolean;
  isMobile?: boolean;
  trackHeight: number;
}>();

const emit = defineEmits<{
  (
    e: 'startResizeFade',
    event: PointerEvent,
    payload: { edge: 'in' | 'out'; durationUs: number },
  ): void;
  (e: 'toggleFadeCurve', payload: { edge: 'in' | 'out' }): void;
  (e: 'startResizeVolume', event: PointerEvent, gain: number): void;
  (e: 'resetVolume'): void;
}>();

function getAudioFadePath(edge: 'in' | 'out', curve: string | undefined): string {
  const isLog = curve === 'logarithmic';
  if (edge === 'in') {
    if (isLog) {
      // Starts from Top-Right (100,0) and curves down to Bottom-Left (0,100)
      // bowing towards Top-Left (0,0)
      return 'M 0,0 L 100,0 C 40,0 0,40 0,100 Z';
    }
    return 'M 0,0 L 100,0 L 0,100 Z';
  } else {
    if (isLog) {
      // Starts from Bottom-Right (100,100) and curves up to Top-Left (0,0)
      // bowing towards Top-Right (100,0)
      return 'M 0,0 L 100,0 L 100,100 C 100,40 60,0 0,0 Z';
    }
    return 'M 0,0 L 100,0 L 100,100 Z';
  }
}

function shouldCollapseFades() {
  return props.clipWidthPx < 20;
}

function clampHandlePx(px: number, width: number) {
  return Math.min(Math.max(0, px), width);
}

function onFadeHandlePointerDown(
  event: PointerEvent,
  payload: { edge: 'in' | 'out'; durationUs: number },
) {
  event.stopPropagation();
  event.preventDefault();

  const startX = event.clientX;
  const startY = event.clientY;
  let didStartDrag = false;

  const cleanup = () => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
  };

  const onPointerMove = (moveEvent: PointerEvent) => {
    if (didStartDrag) return;

    if (Math.abs(moveEvent.clientX - startX) > 3 || Math.abs(moveEvent.clientY - startY) > 3) {
      didStartDrag = true;
      cleanup();
      emit('startResizeFade', moveEvent, payload);
    }
  };

  const onPointerUp = () => {
    cleanup();

    if (!didStartDrag) {
      emit('toggleFadeCurve', { edge: payload.edge });
    }
  };

  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
}

const volumeY = computed(() => {
  const g = Math.max(0, Math.min(2, props.clip.audioGain ?? 1));
  return (1 - g / 2) * 100;
});
</script>

<template>
  <div
    v-if="!shouldCollapseFades()"
    class="absolute inset-0 pointer-events-none"
    style="z-index: 25"
  >
    <!-- Fade Paths -->
    <div class="absolute inset-0 rounded overflow-hidden">
      <svg
        v-if="
          (clip.audioFadeInUs ?? 0) > 0 &&
          (clip.audioFadeInUs ?? 0) <= item.timelineRange.durationUs
        "
        class="absolute left-0 top-0 h-full"
        preserveAspectRatio="none"
        viewBox="0 0 100 100"
        :style="{
          width: `${Math.min(
            Math.max(0, timeUsToPx(Math.max(0, Math.round(Number(clip.audioFadeInUs) || 0)), zoom)),
            clipWidthPx,
          )}px`,
        }"
      >
        <path :d="getAudioFadePath('in', clip.audioFadeInCurve)" fill="var(--clip-lower-tri)" />
      </svg>

      <svg
        v-if="
          (clip.audioFadeOutUs ?? 0) > 0 &&
          (clip.audioFadeOutUs ?? 0) <= item.timelineRange.durationUs
        "
        class="absolute right-0 top-0 h-full"
        preserveAspectRatio="none"
        viewBox="0 0 100 100"
        :style="{
          width: `${Math.min(
            Math.max(
              0,
              timeUsToPx(Math.max(0, Math.round(Number(clip.audioFadeOutUs) || 0)), zoom),
            ),
            clipWidthPx,
          )}px`,
        }"
      >
        <path :d="getAudioFadePath('out', clip.audioFadeOutCurve)" fill="var(--clip-lower-tri)" />
      </svg>
    </div>

    <!-- Fade Handles -->
    <template v-if="canEdit && !clip.locked">
      <div
        class="absolute top-0 w-6 h-6 -ml-3 -translate-y-1/2 transition-opacity z-60 flex items-center justify-center shadow-sm pointer-events-auto"
        :class="[
          clipWidthPx >= 30 ? 'cursor-ew-resize' : 'hidden pointer-events-none',
          isMobile ? 'opacity-100' : 'opacity-0 group-hover/clip:opacity-100',
        ]"
        :style="{
          left: `${clampHandlePx(Math.min(Math.max(0, timeUsToPx(clip.audioFadeInUs || 0, zoom)), clipWidthPx), clipWidthPx)}px`,
        }"
      >
        <div
          class="w-2.5 h-2.5 rounded-full bg-white border border-black/30"
          @pointerdown="
            onFadeHandlePointerDown($event, { edge: 'in', durationUs: clip.audioFadeInUs || 0 })
          "
        ></div>
      </div>

      <div
        class="absolute top-0 w-6 h-6 -mr-3 -translate-y-1/2 transition-opacity z-60 flex items-center justify-center shadow-sm pointer-events-auto"
        :class="[
          clipWidthPx >= 30 ? 'cursor-ew-resize' : 'hidden pointer-events-none',
          isMobile ? 'opacity-100' : 'opacity-0 group-hover/clip:opacity-100',
        ]"
        :style="{
          right: `${clampHandlePx(Math.min(Math.max(0, timeUsToPx(clip.audioFadeOutUs || 0, zoom)), clipWidthPx), clipWidthPx)}px`,
        }"
      >
        <div
          class="w-2.5 h-2.5 rounded-full bg-white border border-black/30"
          @pointerdown="
            onFadeHandlePointerDown($event, { edge: 'out', durationUs: clip.audioFadeOutUs || 0 })
          "
        ></div>
      </div>
    </template>

    <!-- Volume Control Line -->
    <div
      class="absolute left-0 right-0 z-45 h-3 -mt-1.5 flex flex-col justify-center transition-opacity pointer-events-auto"
      :class="[
        canEdit && !clip.locked ? 'cursor-ns-resize' : '',
        clip.audioMuted ? 'opacity-0 hover:opacity-100' : 'opacity-100',
        isDragging && !isResizingVolume ? 'opacity-0! pointer-events-none' : '',
      ]"
      :style="{ top: `${volumeY}%` }"
      @pointerdown.stop.prevent="
        canEdit && !clip.locked && emit('startResizeVolume', $event, clip.audioGain ?? 1)
      "
      @dblclick.stop.prevent="canEdit && !clip.locked && emit('resetVolume')"
    >
      <div
        class="w-full bg-yellow-400 opacity-80"
        :class="[
          clipWidthPx >= (isMobile ? 5 : 15) ? 'opacity-100' : 'hidden',
          isMobile ? 'h-1' : 'h-[1.5px]',
        ]"
      ></div>

      <div
        class="absolute left-1/2 -translate-x-1/2 text-[10px] font-mono text-yellow-400 leading-none py-0.5 bg-black/60 px-1 rounded pointer-events-none select-none transition-opacity"
        :class="[
          clipWidthPx < 30 ? 'hidden' : 'opacity-100',
          (clip.audioGain ?? 1) > 1 ? 'top-full mt-0.5' : 'bottom-full mb-0.5',
        ]"
      >
        {{ Math.round((clip.audioGain ?? 1) * 100) }}%
      </div>
    </div>
  </div>
</template>
