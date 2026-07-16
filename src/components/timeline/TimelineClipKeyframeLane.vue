<script setup lang="ts">
import { TICKS_PER_SECOND } from '~/utils/time';
import { computed, inject, ref } from 'vue';
import type { KeyframeEasing, TimelineClipItem } from '~/timeline/types';
import type { TimelineContext } from './context';
import { pxToDeltaTicks, timeUsToPx } from '~/utils/timeline/geometry';
import { useClipKeyframes } from '~/composables/timeline/useClipKeyframes';
import { KEYFRAME_EASINGS } from '~/timeline/animation/evaluate';
import { animatedParamPaths } from '~/timeline/animation/ops';

/**
 * Unified keyframe "moment" lane: one diamond per distinct time across every
 * animated param on the clip (not one row per param — see `animation/ops.ts`
 * for the cross-param "moment" model). Dragging or double-clicking a diamond
 * moves/deletes/updates easing for the keyframe at that time on every param
 * that has one there. Clicking the empty lane adds a non-destructive keyframe
 * moment for every parameter that is already animated.
 */

const props = defineProps<{
  clip: TimelineClipItem;
  trackId: string;
  zoom: number;
}>();

const { t } = useI18n();
const timelineContext = inject<TimelineContext>('timelineContext')!;

const clipRef = computed(() => props.clip);
const playheadTicks = computed(() => timelineContext.currentTime.value);

const {
  keyframeTimes,
  addKeyframeAtLocal,
  moveKeyframeMomentAt,
  deleteKeyframeMomentAt,
  setKeyframeMomentEasingAt,
} = useClipKeyframes({
  clip: clipRef,
  playheadTicks,
  updateAnimations: (next) => {
    timelineContext.updateClipProperties(props.trackId, props.clip.id, { animations: next });
  },
  seek: (timelineTicks) => timelineContext.setCurrentTimeTicks(timelineTicks),
});

const durationTicks = computed(() => props.clip.timelineRange.durationTicks);

/** The lane only supports click-to-add once at least one param is animated. */
const hasAnimatedParams = computed(() => animatedParamPaths(props.clip.animations).length > 0);

// Click on empty lane background → add a keyframe on every animated param at
// the clicked time (interpolated, so motion is unchanged). Diamonds and their
// own gestures stop propagation, so only bare-background clicks reach here.
function onLaneClick(e: MouseEvent) {
  if (e.target !== e.currentTarget) return;
  if (!hasAnimatedParams.value) return;
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const localTTicks = Math.max(
    0,
    Math.min(durationTicks.value, pxToDeltaTicks(e.clientX - rect.left, props.zoom)),
  );
  addKeyframeAtLocal(localTTicks);
}

// Local drag preview: track the dragged diamond's offset without dispatching a
// store update per pixel; commit once on pointerup.
const draggingFromTTicks = ref<number | null>(null);
const dragDeltaPx = ref(0);

function diamondLeftPx(tTicks: number): number {
  const base = timeUsToPx(tTicks, props.zoom);
  return draggingFromTTicks.value === tTicks ? base + dragDeltaPx.value : base;
}

function formatSeconds(tTicks: number): string {
  return `${(tTicks / TICKS_PER_SECOND).toFixed(2)}s`;
}

function easingAt(tTicks: number): KeyframeEasing {
  for (const path of animatedParamPaths(props.clip.animations)) {
    const keyframe = props.clip.animations?.[path]?.keyframes.find(
      (kf) => Math.round(kf.tTicks) === Math.round(tTicks),
    );
    if (keyframe) return keyframe.easing;
  }
  return 'linear';
}

function nextEasing(easing: KeyframeEasing): KeyframeEasing {
  const index = KEYFRAME_EASINGS.indexOf(easing);
  return KEYFRAME_EASINGS[(index + 1) % KEYFRAME_EASINGS.length] ?? 'linear';
}

function onDiamondPointerDown(tTicks: number, e: PointerEvent) {
  if (e.button !== 0) return;
  e.stopPropagation();
  const target = e.currentTarget as HTMLElement;
  target.setPointerCapture(e.pointerId);
  draggingFromTTicks.value = tTicks;
  dragDeltaPx.value = 0;
  const startX = e.clientX;

  function onMove(ev: PointerEvent) {
    dragDeltaPx.value = ev.clientX - startX;
  }

  function onUp() {
    target.removeEventListener('pointermove', onMove);
    target.removeEventListener('pointerup', onUp);
    target.removeEventListener('pointercancel', onUp);
    if (draggingFromTTicks.value !== null && dragDeltaPx.value !== 0) {
      const deltaTicks = pxToDeltaTicks(dragDeltaPx.value, props.zoom);
      const toTTicks = Math.max(0, Math.min(durationTicks.value, draggingFromTTicks.value + deltaTicks));
      moveKeyframeMomentAt(draggingFromTTicks.value, toTTicks);
    }
    draggingFromTTicks.value = null;
    dragDeltaPx.value = 0;
  }

  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerup', onUp);
  target.addEventListener('pointercancel', onUp);
}

function onDiamondDblClick(tTicks: number, e: MouseEvent) {
  e.stopPropagation();
  deleteKeyframeMomentAt(tTicks);
}

function onDiamondContextMenu(tTicks: number, e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  setKeyframeMomentEasingAt(tTicks, nextEasing(easingAt(tTicks)));
}
</script>

<template>
  <div
    class="relative h-full w-full"
    :class="{ 'cursor-copy': hasAnimatedParams }"
    :title="hasAnimatedParams ? t('fastcat.timeline.keyframesLaneAddHint') : undefined"
    @pointerdown.stop
    @click="onLaneClick"
  >
    <button
      v-for="tTicks in keyframeTimes"
      :key="tTicks"
      type="button"
      class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 cursor-grab active:cursor-grabbing touch-none"
      :style="{ left: `${diamondLeftPx(tTicks)}px`, zIndex: 'var(--z-clip-content)' }"
      :title="`${formatSeconds(tTicks)} · ${easingAt(tTicks)} — ${t('fastcat.timeline.keyframesDiamondHint')}`"
      @pointerdown="(e) => onDiamondPointerDown(tTicks, e)"
      @dblclick="(e) => onDiamondDblClick(tTicks, e)"
      @contextmenu="(e) => onDiamondContextMenu(tTicks, e)"
    >
      <svg viewBox="0 0 24 24" class="w-full h-full fill-current text-amber-400 drop-shadow-sm">
        <path d="M12 2L2 12l10 10 10-10L12 2z" />
      </svg>
    </button>
  </div>
</template>
