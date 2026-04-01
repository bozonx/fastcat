<script setup lang="ts">
import { computed } from 'vue';
import type {
  TimelineTrack,
  TimelineTrackItem,
  TimelineClipItem,
  ClipTransition,
} from '~/timeline/types';
import { timeUsToPx } from '~/utils/timeline/geometry';
import {
  getFadeLinePattern as getTransitionFadeLinePattern,
  getTransitionSolidPath,
  getClipHeadTimelineHandleUs,
  getClipTailTimelineHandleUs,
  getNextClipForItem,
  getPrevClipForItem,
} from '~/utils/timeline/clip';
import { DEFAULT_TRANSITION_CURVE, DEFAULT_TRANSITION_MODE } from '~/transitions';

const { t } = useI18n();

const props = defineProps<{
  clip: TimelineClipItem;
  track: TimelineTrack;
  zoom: number;
  clipWidthPx: number;
  selectedTransition?: { trackId: string; itemId: string; edge: 'in' | 'out' } | null;
  canEdit: boolean;
  trackHeight: number;
  isMobile?: boolean;
}>();

const emit = defineEmits<{
  (
    e: 'select',
    event: PointerEvent,
    payload: { trackId: string; itemId: string; edge: 'in' | 'out' },
  ): void;
  (e: 'resize', event: PointerEvent, payload: { edge: 'in' | 'out'; durationUs: number }): void;
  (
    e: 'createTransition',
    event: PointerEvent,
    payload: { edge: 'in' | 'out'; drag: boolean },
  ): void;
}>();

function transitionUsToPx(us: number) {
  return timeUsToPx(us, props.zoom);
}

function getTransitionButtonClass(selected: boolean, hasProblem: boolean, edge: 'in' | 'out') {
  return [
    'relative',
    edge === 'in' ? 'border-r-2' : 'border-l-2',
    selected ? 'border-transparent ring-2 ring-inset ring-yellow-400 z-30' : 'border-transparent',
    hasProblem ? 'border-red-500 ring-red-500 ring-1' : '',
  ];
}

function isTransitionBackgroundMode(edge: 'in' | 'out') {
  const transition = edge === 'in' ? props.clip.transitionIn : props.clip.transitionOut;
  return (transition?.mode ?? DEFAULT_TRANSITION_MODE) === 'background';
}

function isTransitionTransparentMode(edge: 'in' | 'out') {
  const transition = edge === 'in' ? props.clip.transitionIn : props.clip.transitionOut;
  return (transition?.mode ?? DEFAULT_TRANSITION_MODE) === 'transparent';
}

function isTransitionAdjacentMode(edge: 'in' | 'out') {
  const transition = edge === 'in' ? props.clip.transitionIn : props.clip.transitionOut;
  return (transition?.mode ?? DEFAULT_TRANSITION_MODE) === 'adjacent';
}

function getTransitionHoverOverlayClass(edge: 'in' | 'out') {
  return [
    'absolute inset-0 pointer-events-none opacity-0 group-hover/trans:opacity-100 transition-opacity',
    isTransitionAdjacentMode(edge)
      ? edge === 'in'
        ? 'bg-linear-to-r from-white/0 to-white/10'
        : 'bg-linear-to-r from-white/10 to-white/0'
      : 'bg-white/10',
  ];
}

function getTransitionSvgClass(edge: 'in' | 'out') {
  if (isTransitionBackgroundMode(edge)) {
    return 'w-full h-full block absolute inset-0';
  }

  return edge === 'in'
    ? 'w-full h-full block absolute inset-0 bg-linear-to-r from-transparent to-black/30'
    : 'w-full h-full block absolute inset-0 bg-linear-to-r from-black/30 to-transparent';
}

function hasTransitionInProblem(track: TimelineTrack, item: TimelineClipItem): string | null {
  const tr = item.transitionIn;
  if (!tr) return null;
  const mode = tr.mode ?? DEFAULT_TRANSITION_MODE;

  if (mode === 'background' || mode === 'transparent') return null;

  const needS = tr.durationUs / 1e6;
  const clipDurS = item.timelineRange.durationUs / 1e6;
  if (clipDurS < needS) {
    return t('fastcat.timeline.transition.errorClipTooShort', {
      need: needS.toFixed(2),
      have: clipDurS.toFixed(2),
    });
  }

  if (mode === 'adjacent') {
    const prev = getPrevClipForItem(track, item);
    if (!prev)
      return t(
        'fastcat.timeline.transition.errorNoPreviousClip',
        'No previous clip found for transition',
      );
    const prevEndUs = prev.timelineRange.startUs + prev.timelineRange.durationUs;
    const gapUs = item.timelineRange.startUs - prevEndUs;
    if (gapUs > 1_000)
      return t('fastcat.timeline.transition.errorGapBetweenClips', {
        gapSeconds: (gapUs / 1e6).toFixed(2),
      });
    const prevTailHandleUs = getClipTailTimelineHandleUs(prev);
    if (Number.isFinite(prevTailHandleUs) && prevTailHandleUs < tr.durationUs - 1_000) {
      return t('fastcat.timeline.transition.errorPrevHandleTooShort', {
        needSeconds: needS.toFixed(2),
        haveSeconds: Math.max(0, prevTailHandleUs / 1e6).toFixed(2),
      });
    }
  }

  return null;
}

function hasTransitionOutProblem(track: TimelineTrack, item: TimelineClipItem): string | null {
  const tr = item.transitionOut;
  if (!tr) return null;
  const mode = tr.mode ?? DEFAULT_TRANSITION_MODE;

  if (mode === 'background' || mode === 'transparent') return null;

  const clipDurS = item.timelineRange.durationUs / 1e6;
  const needS = tr.durationUs / 1e6;
  if (clipDurS < needS) {
    return t('fastcat.timeline.transition.errorClipTooShort', {
      need: needS.toFixed(2),
      have: clipDurS.toFixed(2),
    });
  }

  if (mode === 'adjacent') {
    const next = getNextClipForItem(track, item);
    if (!next)
      return t('fastcat.timeline.transition.errorNoNextClip', 'No next clip found for transition');
    const clipEndUs = item.timelineRange.startUs + item.timelineRange.durationUs;
    const gapUs = next.timelineRange.startUs - clipEndUs;
    if (gapUs > 1_000)
      return t('fastcat.timeline.transition.errorGapBetweenClips', {
        gapSeconds: (gapUs / 1e6).toFixed(2),
      });
    const nextHeadHandleUs = getClipHeadTimelineHandleUs(next);
    if (Number.isFinite(nextHeadHandleUs) && nextHeadHandleUs < tr.durationUs - 1_000)
      return t('fastcat.timeline.transition.errorNextHandleTooShort', {
        needSeconds: needS.toFixed(2),
        haveSeconds: Math.max(0, nextHeadHandleUs / 1e6).toFixed(2),
      });
  }

  return null;
}

function hasTransitionProblem(edge: 'in' | 'out'): boolean {
  return Boolean(
    edge === 'in'
      ? hasTransitionInProblem(props.track, props.clip)
      : hasTransitionOutProblem(props.track, props.clip),
  );
}

function getTransitionButtonTitle(edge: 'in' | 'out'): string | undefined {
  const transition = edge === 'in' ? props.clip.transitionIn : props.clip.transitionOut;
  if (!transition) return undefined;

  const mode = transition.mode ?? DEFAULT_TRANSITION_MODE;
  if (mode !== 'adjacent') return undefined;

  return (
    (edge === 'in'
      ? hasTransitionInProblem(props.track, props.clip)
      : hasTransitionOutProblem(props.track, props.clip)) ?? undefined
  );
}

function getTransitionFadeLines(edge: 'in' | 'out') {
  const transition = edge === 'in' ? props.clip.transitionIn : props.clip.transitionOut;
  const curve = transition?.curve ?? DEFAULT_TRANSITION_CURVE;
  return getTransitionFadeLinePattern(edge, curve, 100, transition?.params);
}

function getFadeLineColor(hasProblem: boolean) {
  if (hasProblem) return 'rgba(127, 29, 29, 0.95)';
  return 'rgba(0, 0, 0, 0.82)';
}

function getTransitionCurvePath(edge: 'in' | 'out') {
  const transition = edge === 'in' ? props.clip.transitionIn : props.clip.transitionOut;
  const curve = transition?.curve ?? DEFAULT_TRANSITION_CURVE;
  return getTransitionSolidPath(100, 100, curve, edge, transition?.params);
}

function getTransitionSvgFill(edge: 'in' | 'out', hasProblem: boolean) {
  if (hasProblem) return 'rgba(239, 68, 68, 0.45)';
  return 'var(--clip-lower-tri)';
}

function handleTransitionCreatePointerDown(e: PointerEvent, edge: 'in' | 'out') {
  if (props.isMobile) return;
  if (!props.canEdit || props.clip.locked || props.track.locked) return;
  e.stopPropagation();
  e.preventDefault();

  const startX = e.clientX;
  const startY = e.clientY;
  let isDragging = false;

  const onPointerMove = (moveEvent: PointerEvent) => {
    if (isDragging) return;
    if (Math.abs(moveEvent.clientX - startX) > 3 || Math.abs(moveEvent.clientY - startY) > 3) {
      isDragging = true;
      cleanup();
      emit('createTransition', e, { edge, drag: true });
    }
  };

  const onPointerUp = (upEvent: PointerEvent) => {
    cleanup();
    if (!isDragging) {
      emit('createTransition', upEvent, { edge, drag: false });
    }
  };

  const cleanup = () => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
  };

  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
}
</script>

<template>
  <div class="absolute inset-0 pointer-events-none">
    <div class="absolute inset-0 overflow-hidden rounded" style="z-index: 25">
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
              'in',
            )
          "
          :title="getTransitionButtonTitle('in')"
          @click.stop="
            !isMobile &&
            canEdit &&
            emit('select', $event as PointerEvent, {
              trackId: clip.trackId,
              itemId: clip.id,
              edge: 'in',
            })
          "
        >
          <template v-if="isTransitionTransparentMode('in')">
            <svg
              class="w-full h-full block absolute inset-0"
              preserveAspectRatio="none"
              viewBox="0 0 100 100"
            >
              <rect x="0" y="0" width="100" height="100" fill="transparent" />
              <rect
                v-for="(line, index) in getTransitionFadeLines('in')"
                :key="`fade-in-${index}-${line.x}`"
                :x="line.x"
                y="0"
                :width="line.width"
                height="100"
                :fill="getFadeLineColor(hasTransitionProblem('in'))"
              />
            </svg>
          </template>
          <svg
            v-else
            :class="getTransitionSvgClass('in')"
            preserveAspectRatio="none"
            viewBox="0 0 100 100"
          >
            <path
              :d="getTransitionCurvePath('in')"
              :fill="getTransitionSvgFill('in', hasTransitionProblem('in'))"
            />
          </svg>
          <div :class="getTransitionHoverOverlayClass('in')" />
          <span
            v-if="hasTransitionProblem('in')"
            class="absolute top-1 left-1 w-2 h-2 rounded-full bg-red-500 z-50"
            :title="getTransitionButtonTitle('in')"
          />
          <span
            v-if="isTransitionAdjacentMode('in')"
            class="i-heroicons-squares-plus w-3 h-3 absolute inset-0 m-auto opacity-70"
          />
          <span
            v-else-if="isTransitionBackgroundMode('in')"
            class="i-heroicons-square-3-stack-3d w-3 h-3 absolute inset-0 m-auto opacity-70"
          />
          <div
            v-if="canEdit && !clip.locked && !track.locked"
            class="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize bg-white/0 group-hover/trans:bg-white/20 hover:bg-white/40! transition-colors z-40 pointer-events-auto"
            @pointerdown.stop.prevent="
              emit('resize', $event, { edge: 'in', durationUs: clip.transitionIn!.durationUs })
            "
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
              'out',
            )
          "
          :title="getTransitionButtonTitle('out')"
          @click.stop="
            !isMobile &&
            canEdit &&
            emit('select', $event as PointerEvent, {
              trackId: clip.trackId,
              itemId: clip.id,
              edge: 'out',
            })
          "
        >
          <template v-if="isTransitionTransparentMode('out')">
            <svg
              class="w-full h-full block absolute inset-0"
              preserveAspectRatio="none"
              viewBox="0 0 100 100"
            >
              <rect x="0" y="0" width="100" height="100" fill="transparent" />
              <rect
                v-for="(line, index) in getTransitionFadeLines('out')"
                :key="`fade-out-${index}-${line.x}`"
                :x="line.x"
                y="0"
                :width="line.width"
                height="100"
                :fill="getFadeLineColor(hasTransitionProblem('out'))"
              />
            </svg>
          </template>
          <svg
            v-else
            :class="getTransitionSvgClass('out')"
            preserveAspectRatio="none"
            viewBox="0 0 100 100"
          >
            <path
              :d="getTransitionCurvePath('out')"
              :fill="getTransitionSvgFill('out', hasTransitionProblem('out'))"
            />
          </svg>
          <div :class="getTransitionHoverOverlayClass('out')" />
          <span
            v-if="hasTransitionProblem('out')"
            class="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500 z-50"
            :title="getTransitionButtonTitle('out')"
          />
          <span
            v-if="isTransitionAdjacentMode('out')"
            class="i-heroicons-squares-plus w-3 h-3 absolute inset-0 m-auto opacity-70"
          />
          <span
            v-else-if="isTransitionBackgroundMode('out')"
            class="i-heroicons-square-3-stack-3d w-3 h-3 absolute inset-0 m-auto opacity-70"
          />
          <div
            v-if="canEdit && !clip.locked && !track.locked"
            class="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize bg-white/0 group-hover/trans:bg-white/20 hover:bg-white/40! transition-colors z-40 pointer-events-auto"
            @pointerdown.stop.prevent="
              emit('resize', $event, { edge: 'out', durationUs: clip.transitionOut!.durationUs })
            "
          />
        </button>
      </div>
    </div>

    <!-- Create Transition In Handle -->
    <div
      v-if="!clip.transitionIn && canEdit && !clip.locked && !track.locked"
      class="absolute w-5 h-8 transition-opacity flex items-center justify-center pointer-events-auto"
      :style="{
        top: '50%',
        left: '-8px',
        transform: 'translateY(-50%)',
        zIndex: 'var(--z-clip-handles)',
      }"
      :class="[
        clipWidthPx >= 30 && trackHeight >= 40 ? 'cursor-ew-resize' : 'hidden pointer-events-none',
        isMobile ? 'hidden pointer-events-none' : 'opacity-0 group-hover/clip:opacity-100',
      ]"
      @pointerdown.stop="handleTransitionCreatePointerDown($event, 'in')"
      @click.stop
    >
      <div
        class="w-[9px] h-[12px] bg-white border border-black/30 hover:bg-yellow-400 transition-colors"
        style="clip-path: polygon(0 0, 100% 50%, 0 100%)"
      ></div>
    </div>

    <!-- Create Transition Out Handle -->
    <div
      v-if="!clip.transitionOut && canEdit && !clip.locked && !track.locked"
      class="absolute w-5 h-8 transition-opacity flex items-center justify-center pointer-events-auto"
      :style="{
        top: '50%',
        right: '-8px',
        transform: 'translateY(-50%)',
        zIndex: 'var(--z-clip-handles)',
      }"
      :class="[
        clipWidthPx >= 30 && trackHeight >= 40 ? 'cursor-ew-resize' : 'hidden pointer-events-none',
        isMobile ? 'hidden pointer-events-none' : 'opacity-0 group-hover/clip:opacity-100',
      ]"
      @pointerdown.stop="handleTransitionCreatePointerDown($event, 'out')"
      @click.stop
    >
      <div
        class="w-[9px] h-[12px] bg-white border border-black/30 hover:bg-yellow-400 transition-colors"
        style="clip-path: polygon(0 50%, 100% 0, 100% 100%)"
      ></div>
    </div>
  </div>
</template>
