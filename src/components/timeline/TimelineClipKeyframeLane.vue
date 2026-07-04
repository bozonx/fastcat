<script setup lang="ts">
import { computed, inject, ref } from 'vue';
import type { KeyframeEasing, TimelineClipItem } from '~/timeline/types';
import type { TimelineContext } from './context';
import { pxToDeltaUs, timeUsToPx } from '~/utils/timeline/geometry';
import { useClipKeyframes } from '~/composables/timeline/useClipKeyframes';
import { ANIMATABLE_PARAM_PATHS, KEYFRAME_EASINGS } from '~/timeline/animation/evaluate';

/**
 * Unified keyframe "moment" lane: one diamond per distinct time across every
 * animated param on the clip (not one row per param — see `animation/ops.ts`
 * for the cross-param "moment" model). Dragging or double-clicking a diamond
 * moves/deletes/updates easing for the keyframe at that time on every param
 * that has one there. Adding a new keyframe happens from the properties panel's
 * stopwatch toggle, not from this lane.
 */

const props = defineProps<{
  clip: TimelineClipItem;
  trackId: string;
  zoom: number;
}>();

const { t } = useI18n();
const timelineContext = inject<TimelineContext>('timelineContext')!;

const clipRef = computed(() => props.clip);
const playheadUs = computed(() => timelineContext.currentTime.value);

const { keyframeTimes, moveKeyframeMomentAt, deleteKeyframeMomentAt, setKeyframeMomentEasingAt } =
  useClipKeyframes({
    clip: clipRef,
    playheadUs,
    updateAnimations: (next) => {
      timelineContext.updateClipProperties(props.trackId, props.clip.id, { animations: next });
    },
  });

const durationUs = computed(() => props.clip.timelineRange.durationUs);

// Local drag preview: track the dragged diamond's offset without dispatching a
// store update per pixel; commit once on pointerup.
const draggingFromTUs = ref<number | null>(null);
const dragDeltaPx = ref(0);

function diamondLeftPx(tUs: number): number {
  const base = timeUsToPx(tUs, props.zoom);
  return draggingFromTUs.value === tUs ? base + dragDeltaPx.value : base;
}

function formatSeconds(tUs: number): string {
  return `${(tUs / 1_000_000).toFixed(2)}s`;
}

function easingAt(tUs: number): KeyframeEasing {
  for (const path of ANIMATABLE_PARAM_PATHS) {
    const keyframe = props.clip.animations?.[path]?.keyframes.find(
      (kf) => Math.round(kf.tUs) === Math.round(tUs),
    );
    if (keyframe) return keyframe.easing;
  }
  return 'linear';
}

function nextEasing(easing: KeyframeEasing): KeyframeEasing {
  const index = KEYFRAME_EASINGS.indexOf(easing);
  return KEYFRAME_EASINGS[(index + 1) % KEYFRAME_EASINGS.length] ?? 'linear';
}

function onDiamondPointerDown(tUs: number, e: PointerEvent) {
  if (e.button !== 0) return;
  e.stopPropagation();
  const target = e.currentTarget as HTMLElement;
  target.setPointerCapture(e.pointerId);
  draggingFromTUs.value = tUs;
  dragDeltaPx.value = 0;
  const startX = e.clientX;

  function onMove(ev: PointerEvent) {
    dragDeltaPx.value = ev.clientX - startX;
  }

  function onUp() {
    target.removeEventListener('pointermove', onMove);
    target.removeEventListener('pointerup', onUp);
    target.removeEventListener('pointercancel', onUp);
    if (draggingFromTUs.value !== null && dragDeltaPx.value !== 0) {
      const deltaUs = pxToDeltaUs(dragDeltaPx.value, props.zoom);
      const toTUs = Math.max(0, Math.min(durationUs.value, draggingFromTUs.value + deltaUs));
      moveKeyframeMomentAt(draggingFromTUs.value, toTUs);
    }
    draggingFromTUs.value = null;
    dragDeltaPx.value = 0;
  }

  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerup', onUp);
  target.addEventListener('pointercancel', onUp);
}

function onDiamondDblClick(tUs: number, e: MouseEvent) {
  e.stopPropagation();
  deleteKeyframeMomentAt(tUs);
}

function onDiamondContextMenu(tUs: number, e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  setKeyframeMomentEasingAt(tUs, nextEasing(easingAt(tUs)));
}
</script>

<template>
  <div class="relative h-full w-full" @pointerdown.stop>
    <button
      v-for="tUs in keyframeTimes"
      :key="tUs"
      type="button"
      class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 cursor-grab active:cursor-grabbing touch-none"
      :style="{ left: `${diamondLeftPx(tUs)}px`, zIndex: 'var(--z-clip-content)' }"
      :title="`${formatSeconds(tUs)} · ${easingAt(tUs)} — ${t('fastcat.timeline.keyframesDiamondHint')}`"
      @pointerdown="(e) => onDiamondPointerDown(tUs, e)"
      @dblclick="(e) => onDiamondDblClick(tUs, e)"
      @contextmenu="(e) => onDiamondContextMenu(tUs, e)"
    >
      <svg viewBox="0 0 24 24" class="w-full h-full fill-current text-amber-400 drop-shadow-sm">
        <path d="M12 2L2 12l10 10 10-10L12 2z" />
      </svg>
    </button>
  </div>
</template>
