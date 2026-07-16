<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type {
  AnimatableParamPath,
  Keyframe,
  KeyframeEasing,
  TimelineClipItem,
} from '~/timeline/types';
import type { TimelineContext } from './context';
import { clampAnimatedValue, KEYFRAME_EASINGS } from '~/timeline/animation/evaluate';
import {
  animatedParamPaths,
  removeKeyframe,
  setKeyframeEasing,
  updateKeyframe,
  upsertKeyframe,
} from '~/timeline/animation/ops';
import {
  buildCurvePolyline,
  curveYToValue,
  keyframeToCurvePoint,
  resolveCurveValueRange,
} from '~/timeline/animation/curve-editor';
import { useClipKeyframes } from '~/composables/timeline/useClipKeyframes';
import { pxToDeltaTicks, timeUsToPx } from '~/utils/timeline/geometry';

const props = defineProps<{
  clip: TimelineClipItem;
  trackId: string;
  zoom: number;
}>();

const { t } = useI18n();
const timelineContext = inject<TimelineContext>('timelineContext')!;
const rootEl = ref<HTMLElement | null>(null);
const widthPx = ref(1);
let resizeObserver: ResizeObserver | null = null;

const SVG_HEIGHT_PX = 56;
const SVG_PADDING_PX = 7;
const CLICK_DRAG_THRESHOLD_PX = 3;

const clipRef = computed(() => props.clip);
const playheadTicks = computed(() => timelineContext.currentTime.value);
const { localPlayheadTicks } = useClipKeyframes({
  clip: clipRef,
  playheadTicks,
  updateAnimations,
});

const paramPaths = computed(() => animatedParamPaths(props.clip.animations));
const selectedPath = ref<AnimatableParamPath | null>(null);
const selectedTrack = computed(() =>
  selectedPath.value ? props.clip.animations?.[selectedPath.value] : undefined,
);
const valueRange = computed(() => resolveCurveValueRange(selectedTrack.value));
const durationTicks = computed(() => props.clip.timelineRange.durationTicks);
const svgWidthPx = computed(() =>
  Math.max(1, timeUsToPx(Math.max(1, durationTicks.value), props.zoom), widthPx.value),
);
const polylinePoints = computed(() =>
  selectedTrack.value
    ? buildCurvePolyline({
        track: selectedTrack.value,
        durationTicks: durationTicks.value,
        widthPx: svgWidthPx.value,
        heightPx: SVG_HEIGHT_PX,
        paddingPx: SVG_PADDING_PX,
      })
    : [],
);
const polylineAttribute = computed(() =>
  polylinePoints.value.map((point) => `${point.x},${point.y}`).join(' '),
);
const keyframePoints = computed(() =>
  (selectedTrack.value?.keyframes ?? []).map((keyframe) => ({
    keyframe,
    point: keyframeToCurvePoint({
      keyframe,
      range: valueRange.value,
      durationTicks: durationTicks.value,
      widthPx: svgWidthPx.value,
      heightPx: SVG_HEIGHT_PX,
      paddingPx: SVG_PADDING_PX,
    }),
  })),
);
const playheadX = computed(() =>
  Math.max(0, Math.min(svgWidthPx.value, timeUsToPx(localPlayheadTicks.value, props.zoom))),
);

const dragState = ref<{
  fromTTicks: number;
  clientX: number;
  clientY: number;
  moved: boolean;
  point: { x: number; y: number };
} | null>(null);
const suppressNextKeyframeClick = ref(false);

watch(
  paramPaths,
  (paths) => {
    if (!paths.length) {
      selectedPath.value = null;
      return;
    }
    if (!selectedPath.value || !paths.includes(selectedPath.value)) {
      selectedPath.value = paths[0] ?? null;
    }
  },
  { immediate: true },
);

onMounted(async () => {
  await nextTick();
  updateWidth();
  if (typeof ResizeObserver === 'undefined' || !rootEl.value) return;
  resizeObserver = new ResizeObserver(updateWidth);
  resizeObserver.observe(rootEl.value);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
});

function updateWidth() {
  widthPx.value = Math.max(1, rootEl.value?.clientWidth ?? 1);
}

function updateAnimations(next: TimelineClipItem['animations']) {
  timelineContext.updateClipProperties(props.trackId, props.clip.id, { animations: next });
}

function nextEasing(easing: KeyframeEasing): KeyframeEasing {
  const index = KEYFRAME_EASINGS.indexOf(easing);
  return KEYFRAME_EASINGS[(index + 1) % KEYFRAME_EASINGS.length] ?? 'linear';
}

function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function localPointFromEvent(e: PointerEvent | MouseEvent): { x: number; y: number } {
  const svg = (
    e.currentTarget instanceof SVGSVGElement
      ? e.currentTarget
      : (e.currentTarget as SVGElement).ownerSVGElement
  ) as SVGSVGElement;
  const rect = svg.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / Math.max(1, rect.width)) * svgWidthPx.value;
  const y = ((e.clientY - rect.top) / Math.max(1, rect.height)) * SVG_HEIGHT_PX;
  return { x: Math.max(0, Math.min(svgWidthPx.value, x)), y };
}

function tUsFromX(x: number): number {
  return Math.max(0, Math.min(durationTicks.value, pxToDeltaTicks(x, props.zoom)));
}

function valueFromY(y: number): number {
  if (!selectedPath.value) return 0;
  const value = curveYToValue({
    y,
    range: valueRange.value,
    heightPx: SVG_HEIGHT_PX,
    paddingPx: SVG_PADDING_PX,
  });
  return clampAnimatedValue(selectedPath.value, value);
}

function pointForKeyframe(keyframe: Keyframe): { x: number; y: number } {
  if (dragState.value?.fromTTicks === keyframe.tTicks) return dragState.value.point;
  return (
    keyframePoints.value.find((entry) => entry.keyframe.tTicks === keyframe.tTicks)?.point ?? {
      x: 0,
      y: SVG_HEIGHT_PX / 2,
    }
  );
}

function onBackgroundClick(e: MouseEvent) {
  if (!selectedPath.value || e.target !== e.currentTarget) return;
  const point = localPointFromEvent(e);
  updateAnimations(
    upsertKeyframe(
      props.clip.animations,
      selectedPath.value,
      tUsFromX(point.x),
      valueFromY(point.y),
    ),
  );
}

function easingKeyframeAtX(x: number): Keyframe | null {
  const keyframes = selectedTrack.value?.keyframes ?? [];
  if (!keyframes.length) return null;
  const tTicks = tUsFromX(x);
  return [...keyframes].reverse().find((keyframe) => keyframe.tTicks <= tTicks) ?? keyframes[0] ?? null;
}

function cycleEasingAtKeyframe(keyframe: Keyframe) {
  if (!selectedPath.value) return;
  updateAnimations(
    setKeyframeEasing(
      props.clip.animations,
      selectedPath.value,
      keyframe.tTicks,
      nextEasing(keyframe.easing),
    ),
  );
}

function onCurveClick(e: MouseEvent) {
  e.stopPropagation();
  const keyframe = easingKeyframeAtX(localPointFromEvent(e).x);
  if (keyframe) cycleEasingAtKeyframe(keyframe);
}

function onKeyframePointerDown(keyframe: Keyframe, e: PointerEvent) {
  if (e.button !== 0) return;
  e.stopPropagation();
  const target = e.currentTarget as SVGCircleElement;
  target.setPointerCapture(e.pointerId);
  const startPoint = pointForKeyframe(keyframe);
  dragState.value = {
    fromTTicks: keyframe.tTicks,
    clientX: e.clientX,
    clientY: e.clientY,
    moved: false,
    point: startPoint,
  };

  function onMove(ev: PointerEvent) {
    if (!dragState.value) return;
    const dx = ev.clientX - dragState.value.clientX;
    const dy = ev.clientY - dragState.value.clientY;
    dragState.value = {
      ...dragState.value,
      moved:
        dragState.value.moved ||
        Math.abs(dx) > CLICK_DRAG_THRESHOLD_PX ||
        Math.abs(dy) > CLICK_DRAG_THRESHOLD_PX,
      point: {
        x: Math.max(0, Math.min(svgWidthPx.value, startPoint.x + dx)),
        y: Math.max(SVG_PADDING_PX, Math.min(SVG_HEIGHT_PX - SVG_PADDING_PX, startPoint.y + dy)),
      },
    };
  }

  function onUp() {
    target.removeEventListener('pointermove', onMove);
    target.removeEventListener('pointerup', onUp);
    target.removeEventListener('pointercancel', onUp);
    const state = dragState.value;
    dragState.value = null;
    suppressNextKeyframeClick.value = !!state?.moved;
    if (!state?.moved || !selectedPath.value) return;
    updateAnimations(
      updateKeyframe(props.clip.animations, {
        path: selectedPath.value,
        fromTTicks: state.fromTTicks,
        toTTicks: tUsFromX(state.point.x),
        value: valueFromY(state.point.y),
      }),
    );
  }

  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerup', onUp);
  target.addEventListener('pointercancel', onUp);
}

function onKeyframeClick(keyframe: Keyframe, e: MouseEvent) {
  e.stopPropagation();
  if (suppressNextKeyframeClick.value) {
    suppressNextKeyframeClick.value = false;
    return;
  }
  cycleEasingAtKeyframe(keyframe);
}

function onKeyframeDblClick(keyframe: Keyframe, e: MouseEvent) {
  e.stopPropagation();
  if (!selectedPath.value) return;
  updateAnimations(removeKeyframe(props.clip.animations, selectedPath.value, keyframe.tTicks));
}
</script>

<template>
  <div ref="rootEl" class="h-full w-full min-w-0 flex bg-slate-950/90 text-white">
    <div class="w-28 shrink-0 border-r border-white/10 px-1.5 py-1 flex items-start">
      <select
        v-model="selectedPath"
        class="w-full min-w-0 rounded border border-white/10 bg-slate-900 px-1 py-0.5 text-[10px] leading-4 text-white/85 outline-none focus:border-amber-400/70"
        :aria-label="t('fastcat.timeline.keyframesCurveParam')"
        @pointerdown.stop
        @click.stop
      >
        <option v-for="path in paramPaths" :key="path" :value="path">
          {{ path }}
        </option>
      </select>
    </div>

    <svg
      v-if="selectedTrack"
      class="block h-full min-w-0 flex-1 cursor-crosshair touch-none"
      :viewBox="`0 0 ${svgWidthPx} ${SVG_HEIGHT_PX}`"
      preserveAspectRatio="none"
      role="img"
      :aria-label="t('fastcat.timeline.keyframesCurveEditor')"
      @click="onBackgroundClick"
    >
      <line
        :x1="0"
        :x2="svgWidthPx"
        :y1="SVG_PADDING_PX"
        :y2="SVG_PADDING_PX"
        stroke="rgba(255,255,255,0.08)"
      />
      <line
        :x1="0"
        :x2="svgWidthPx"
        :y1="SVG_HEIGHT_PX - SVG_PADDING_PX"
        :y2="SVG_HEIGHT_PX - SVG_PADDING_PX"
        stroke="rgba(255,255,255,0.08)"
      />
      <line
        :x1="playheadX"
        :x2="playheadX"
        :y1="0"
        :y2="SVG_HEIGHT_PX"
        stroke="rgba(34,211,238,0.9)"
        stroke-width="1"
        vector-effect="non-scaling-stroke"
      />
      <polyline
        :points="polylineAttribute"
        fill="none"
        stroke="rgba(251,191,36,0.95)"
        stroke-width="2"
        vector-effect="non-scaling-stroke"
        class="cursor-pointer"
        @click="onCurveClick"
      />
      <circle
        v-for="{ keyframe } in keyframePoints"
        :key="keyframe.tTicks"
        :cx="pointForKeyframe(keyframe).x"
        :cy="pointForKeyframe(keyframe).y"
        r="4"
        fill="rgb(251,191,36)"
        stroke="rgb(15,23,42)"
        stroke-width="1.5"
        vector-effect="non-scaling-stroke"
        class="cursor-grab active:cursor-grabbing"
        :aria-label="`${selectedPath}: ${formatValue(keyframe.value)} ${keyframe.easing}`"
        @pointerdown="(e) => onKeyframePointerDown(keyframe, e)"
        @click="(e) => onKeyframeClick(keyframe, e)"
        @dblclick="(e) => onKeyframeDblClick(keyframe, e)"
      />
    </svg>
  </div>
</template>
