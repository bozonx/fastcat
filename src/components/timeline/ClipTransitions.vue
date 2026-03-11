<script setup lang="ts">
import { computed } from 'vue';
import type { TimelineTrack, TimelineTrackItem, TimelineClipItem, ClipTransition } from '~/timeline/types';
import { timeUsToPx } from '~/utils/timeline/geometry';

const props = defineProps<{
  clip: TimelineClipItem;
  track: TimelineTrack;
  zoom: number;
  selectedTransition?: { trackId: string; itemId: string; edge: 'in' | 'out' } | null;
  canEdit: boolean;
}>();

const emit = defineEmits<{
  (e: 'select', event: PointerEvent, payload: { trackId: string; itemId: string; edge: 'in' | 'out' }): void;
  (e: 'resize', event: PointerEvent, payload: { edge: 'in' | 'out'; durationUs: number }): void;
}>();

const DEFAULT_TRANSITION_MODE = 'fade';

function transitionUsToPx(us: number) {
  return timeUsToPx(us, props.zoom);
}

function getTransitionButtonClass(selected: boolean, hasProblem: boolean, overridden: boolean) {
  return [
    selected ? 'bg-primary-500/40 ring-2 ring-primary-500 z-30' : 'bg-black/20 hover:bg-black/30',
    hasProblem ? 'border border-red-500 ring-red-500 ring-1' : '',
    overridden ? 'border border-yellow-400 ring-yellow-400 ring-1' : '',
  ];
}

function hasTransitionProblem(edge: 'in' | 'out') {
  return false; // simplified as per main component
}

function getTransitionButtonTitle(edge: 'in' | 'out') {
  return edge === 'in' ? 'Transition In' : 'Transition Out';
}

function getTransitionFadeLines() {
  const lines = [];
  for (let i = 0; i < 5; i++) {
    lines.push({ x: i * 20, width: 2 });
  }
  return lines;
}

function getFadeLineColor(problem: boolean) {
  return problem ? 'rgba(239, 68, 68, 0.4)' : 'rgba(255, 255, 255, 0.1)';
}

function getTransitionCurvePath(edge: 'in' | 'out') {
  if (edge === 'in') return 'M 0 100 Q 50 100 100 0 L 100 100 L 0 100 Z';
  return 'M 0 0 Q 50 100 100 100 L 100 100 L 0 100 Z';
}

function getTransitionSvgFill(edge: 'in' | 'out', problem: boolean) {
  return problem ? 'rgba(239, 68, 68, 0.3)' : 'rgba(255, 255, 255, 0.1)';
}
</script>

<template>
  <div class="absolute inset-0 pointer-events-none overflow-hidden rounded">
    <!-- Transition In -->
    <div
      v-if="clip.transitionIn"
      class="absolute left-0 top-0 bottom-0 z-10"
      :style="{ width: `${transitionUsToPx(clip.transitionIn.durationUs)}px` }"
    >
      <button
        type="button"
        class="w-full h-full overflow-hidden group/trans pointer-events-auto"
        :class="
          getTransitionButtonClass(
            selectedTransition?.itemId === clip.id && selectedTransition?.edge === 'in',
            hasTransitionProblem('in'),
            Boolean(clip.transitionIn.isOverridden),
          )
        "
        :title="getTransitionButtonTitle('in')"
        @pointerdown.stop
        @click.stop="
          canEdit &&
          emit('select', $event as PointerEvent, {
            trackId: clip.trackId,
            itemId: clip.id,
            edge: 'in',
          })
        "
      >
        <template v-if="(clip.transitionIn.mode ?? DEFAULT_TRANSITION_MODE) === 'fade'">
          <svg class="w-full h-full block absolute inset-0" preserveAspectRatio="none" viewBox="0 0 100 100">
            <rect x="0" y="0" width="100" height="100" fill="rgba(255,255,255,0.04)" />
            <rect
              v-for="line in getTransitionFadeLines()"
              :key="`fade-in-${line.x}`"
              :x="line.x"
              y="0"
              :width="line.width"
              height="100"
              :fill="getFadeLineColor(hasTransitionProblem('in'))"
            />
          </svg>
        </template>
        <svg v-else class="w-full h-full block absolute inset-0" preserveAspectRatio="none" viewBox="0 0 100 100">
          <path :d="getTransitionCurvePath('in')" :fill="getTransitionSvgFill('in', hasTransitionProblem('in'))" />
        </svg>
        <span v-if="(clip.transitionIn.mode ?? DEFAULT_TRANSITION_MODE) === 'transition'" class="i-heroicons-squares-plus w-3 h-3 absolute inset-0 m-auto opacity-70" />
        <div
          v-if="canEdit && !clip.locked"
          class="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize bg-white/0 group-hover/trans:bg-white/20 hover:bg-white/40! transition-colors z-40"
          @pointerdown.stop.prevent="emit('resize', $event, { edge: 'in', durationUs: clip.transitionIn!.durationUs })"
        />
      </button>
    </div>

    <!-- Transition Out -->
    <div
      v-if="clip.transitionOut"
      class="absolute right-0 top-0 bottom-0 z-10"
      :style="{ width: `${transitionUsToPx(clip.transitionOut.durationUs)}px` }"
    >
      <button
        type="button"
        class="w-full h-full overflow-hidden group/trans pointer-events-auto"
        :class="
          getTransitionButtonClass(
            selectedTransition?.itemId === clip.id && selectedTransition?.edge === 'out',
            hasTransitionProblem('out'),
            Boolean(clip.transitionOut.isOverridden),
          )
        "
        :title="getTransitionButtonTitle('out')"
        @pointerdown.stop
        @click.stop="
          canEdit &&
          emit('select', $event as PointerEvent, {
            trackId: clip.trackId,
            itemId: clip.id,
            edge: 'out',
          })
        "
      >
        <template v-if="(clip.transitionOut.mode ?? DEFAULT_TRANSITION_MODE) === 'fade'">
          <svg class="w-full h-full block absolute inset-0" preserveAspectRatio="none" viewBox="0 0 100 100">
            <rect x="0" y="0" width="100" height="100" fill="rgba(255,255,255,0.04)" />
            <rect
              v-for="line in getTransitionFadeLines()"
              :key="`fade-out-${line.x}`"
              :x="line.x"
              y="0"
              :width="line.width"
              height="100"
              :fill="getFadeLineColor(hasTransitionProblem('out'))"
            />
          </svg>
        </template>
        <svg v-else class="w-full h-full block absolute inset-0" preserveAspectRatio="none" viewBox="0 0 100 100">
          <path :d="getTransitionCurvePath('out')" :fill="getTransitionSvgFill('out', hasTransitionProblem('out'))" />
        </svg>
        <span v-if="(clip.transitionOut.mode ?? DEFAULT_TRANSITION_MODE) === 'transition'" class="i-heroicons-squares-plus w-3 h-3 absolute inset-0 m-auto opacity-70" />
        <div
          v-if="canEdit && !clip.locked"
          class="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize bg-white/0 group-hover/trans:bg-white/20 hover:bg-white/40! transition-colors z-40"
          @pointerdown.stop.prevent="emit('resize', $event, { edge: 'out', durationUs: clip.transitionOut!.durationUs })"
        />
      </button>
    </div>
  </div>
</template>
