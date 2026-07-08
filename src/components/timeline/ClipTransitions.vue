<script setup lang="ts">
import { computed } from 'vue';
import type { TimelineTrack, TimelineClipItem } from '~/timeline/types';
import { timeUsToPx } from '~/utils/timeline/geometry';
import {
  getFadeLinePattern as getTransitionFadeLinePattern,
  getTransitionSolidPath,
} from '~/utils/timeline/clip';
import {
  validateTransitionIn,
  validateTransitionOut,
  type TransitionValidationError,
} from '~/utils/timeline/transition-validation';
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
  /** Vertical insets (px) so transitions cover only the content band, not the header/keyframes lane. */
  topInsetPx?: number;
  bottomInsetPx?: number;
}>();

const emit = defineEmits<{
  (
    e: 'select',
    event: PointerEvent,
    payload: { trackId: string; itemId: string; edge: 'in' | 'out' },
  ): void;
  (e: 'resize', event: PointerEvent, payload: { edge: 'in' | 'out'; durationUs: number }): void;
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

function getErrorMessage(error: TransitionValidationError | null): string | null {
  if (!error) return null;
  return t(error.key, error.params ?? {});
}

function hasTransitionProblem(edge: 'in' | 'out'): boolean {
  return Boolean(
    edge === 'in'
      ? getErrorMessage(validateTransitionIn(props.track, props.clip))
      : getErrorMessage(validateTransitionOut(props.track, props.clip)),
  );
}

function getTransitionButtonTitle(edge: 'in' | 'out'): string | undefined {
  const transition = edge === 'in' ? props.clip.transitionIn : props.clip.transitionOut;
  if (!transition) return undefined;

  const mode = transition.mode ?? DEFAULT_TRANSITION_MODE;
  if (mode !== 'adjacent') return undefined;

  return (
    (edge === 'in'
      ? getErrorMessage(validateTransitionIn(props.track, props.clip))
      : getErrorMessage(validateTransitionOut(props.track, props.clip))) ?? undefined
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

</script>

<template>
  <div
    class="absolute left-0 right-0 pointer-events-none"
    :style="{
      top: `${topInsetPx ?? 0}px`,
      bottom: `${bottomInsetPx ?? 0}px`,
      zIndex: 'calc(var(--z-clip-handles) + 1)',
    }"
  >
    <div class="absolute inset-0 overflow-hidden rounded" style="z-index: 25">
      <!-- Transition In -->
      <div
        v-if="clip.transitionIn"
        class="absolute left-0 top-0 bottom-0 z-10"
        :style="{ width: `${transitionUsToPx(clip.transitionIn.durationUs)}px` }"
      >
        <UiTooltip
          :text="getTransitionButtonTitle('in')"
          :disabled="!getTransitionButtonTitle('in')"
          trigger-class="w-full h-full"
        >
          <button
            data-testid="transition-in"
            type="button"
            :class="[
              'w-full h-full overflow-hidden group/trans',
              isMobile ? 'pointer-events-none' : 'pointer-events-auto',
              getTransitionButtonClass(
                selectedTransition?.itemId === clip.id && selectedTransition?.edge === 'in',
                hasTransitionProblem('in'),
                'in',
              ),
            ]"
            @click.stop="
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
              :aria-label="getTransitionButtonTitle('in')"
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
              v-if="!isMobile && canEdit && !clip.locked && !track.locked"
              class="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize bg-white/0 group-hover/trans:bg-white/20 hover:bg-white/40! transition-colors z-40 pointer-events-auto touch-none"
              @pointerdown.stop.prevent="
                emit('resize', $event, { edge: 'in', durationUs: clip.transitionIn!.durationUs })
              "
            />
          </button>
        </UiTooltip>
      </div>

      <!-- Transition Out -->
      <div
        v-if="clip.transitionOut"
        class="absolute right-0 top-0 bottom-0 z-10"
        :style="{ width: `${transitionUsToPx(clip.transitionOut.durationUs)}px` }"
      >
        <UiTooltip
          :text="getTransitionButtonTitle('out')"
          :disabled="!getTransitionButtonTitle('out')"
          trigger-class="w-full h-full"
        >
          <button
            data-testid="transition-out"
            type="button"
            :class="[
              'w-full h-full overflow-hidden group/trans',
              isMobile ? 'pointer-events-none' : 'pointer-events-auto',
              getTransitionButtonClass(
                selectedTransition?.itemId === clip.id && selectedTransition?.edge === 'out',
                hasTransitionProblem('out'),
                'out',
              ),
            ]"
            @click.stop="
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
              :aria-label="getTransitionButtonTitle('out')"
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
              v-if="!isMobile && canEdit && !clip.locked && !track.locked"
              class="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize bg-white/0 group-hover/trans:bg-white/20 hover:bg-white/40! transition-colors z-40 pointer-events-auto touch-none"
              @pointerdown.stop.prevent="
                emit('resize', $event, { edge: 'out', durationUs: clip.transitionOut!.durationUs })
              "
            />
          </button>
        </UiTooltip>
      </div>
    </div>
  </div>
</template>
