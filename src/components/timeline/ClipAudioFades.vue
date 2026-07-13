<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue';
import type {
  AudioFadeCurve,
  TimelineTrack,
  TimelineClipItem,
  TimelineTrackItem,
} from '~/timeline/types';
import { timeUsToPx, computeClipCenteredOverlayLeftPx } from '~/utils/timeline/geometry';
import { clipGainToYPercent } from '~/utils/audio';

const props = defineProps<{
  clip: TimelineClipItem;
  item: TimelineTrackItem;
  track: TimelineTrack;
  zoom: number;
  clipWidthPx: number;
  canEdit: boolean;
  isDragging?: boolean;
  isResizingVolume?: boolean;
  /** Hide the fade drag handles (but keep the fade shapes) while trimming/slipping. */
  hideFadeHandles?: boolean;
  isMobile?: boolean;
  isHovered?: boolean;
  isSelected?: boolean;
  trackHeight: number;
  scrollLeft?: number;
  viewportWidth?: number;
  /** Vertical insets (px) so fades/handles stay within the content band, below the header. */
  topInsetPx?: number;
  bottomInsetPx?: number;
  defaultFadeDurationUs?: number;
  defaultFadeCurve?: AudioFadeCurve;
}>();

const emit = defineEmits<{
  (
    e: 'startResizeFade',
    event: PointerEvent,
    payload: { edge: 'in' | 'out'; durationUs: number },
  ): void;
  (e: 'toggleFadeCurve', payload: { edge: 'in' | 'out' }): void;
  (
    e: 'commitFade',
    payload: { edge: 'in' | 'out'; durationUs: number; curve?: AudioFadeCurve },
  ): void;
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

function getFadeHandlePositionPx(edge: 'in' | 'out') {
  const fadeUs = getFadeDurationUs(edge);
  const fadePx = Math.min(Math.max(0, timeUsToPx(fadeUs, props.zoom)), props.clipWidthPx);

  if (edge === 'in') {
    return Math.max(0, Math.min(props.clipWidthPx, fadePx));
  }

  return Math.max(0, Math.min(props.clipWidthPx, props.clipWidthPx - fadePx));
}

function getFadeDurationUs(edge: 'in' | 'out') {
  return Math.max(
    0,
    Math.round(Number(edge === 'in' ? props.clip.audioFadeInUs : props.clip.audioFadeOutUs) || 0),
  );
}

function getOppositeFadeDurationUs(edge: 'in' | 'out') {
  return getFadeDurationUs(edge === 'in' ? 'out' : 'in');
}

function getDefaultFadeDurationUs(edge: 'in' | 'out') {
  const clipDurationUs = Math.max(0, Math.round(Number(props.item.timelineRange.durationUs) || 0));
  const maxUs = Math.max(0, clipDurationUs - getOppositeFadeDurationUs(edge));
  const configuredUs = Math.max(0, Math.round(Number(props.defaultFadeDurationUs) || 0));
  return Math.min(maxUs, configuredUs);
}

// Track the in-progress drag so we can drop window listeners on unmount.
let activeFadeCleanup: (() => void) | null = null;
let pendingFadeClickTimeout: number | null = null;

function cancelPendingFadeClick() {
  if (pendingFadeClickTimeout === null) return;
  window.clearTimeout(pendingFadeClickTimeout);
  pendingFadeClickTimeout = null;
}

function commitFadeClick(edge: 'in' | 'out') {
  const currentDurationUs = getFadeDurationUs(edge);

  if (currentDurationUs <= 0) {
    const durationUs = getDefaultFadeDurationUs(edge);
    if (durationUs <= 0) return;
    emit('commitFade', {
      edge,
      durationUs,
      curve: props.defaultFadeCurve === 'linear' ? 'linear' : 'logarithmic',
    });
    return;
  }

  emit('toggleFadeCurve', { edge });
}

function scheduleFadeClick(edge: 'in' | 'out') {
  cancelPendingFadeClick();
  pendingFadeClickTimeout = window.setTimeout(() => {
    pendingFadeClickTimeout = null;
    commitFadeClick(edge);
  }, 220);
}

function onFadeHandleDblClick(event: MouseEvent, edge: 'in' | 'out') {
  event.stopPropagation();
  event.preventDefault();
  cancelPendingFadeClick();

  if (getFadeDurationUs(edge) > 0) {
    emit('commitFade', { edge, durationUs: 0 });
  }
}

function onFadeHandlePointerDown(
  event: PointerEvent,
  payload: { edge: 'in' | 'out'; durationUs: number },
) {
  event.stopPropagation();
  event.preventDefault();

  if (activeFadeCleanup) activeFadeCleanup();

  const startX = event.clientX;
  const startY = event.clientY;
  let didStartDrag = false;

  const cleanup = () => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    if (activeFadeCleanup === cleanup) activeFadeCleanup = null;
  };

  const onPointerMove = (moveEvent: PointerEvent) => {
    if (didStartDrag) return;

    if (Math.abs(moveEvent.clientX - startX) > 3 || Math.abs(moveEvent.clientY - startY) > 3) {
      didStartDrag = true;
      cleanup();
      emit('startResizeFade', event, payload);
    }
  };

  const onPointerUp = () => {
    cleanup();

    if (!didStartDrag && !props.isMobile) {
      scheduleFadeClick(payload.edge);
    }
  };

  activeFadeCleanup = cleanup;
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
}

onBeforeUnmount(() => {
  cancelPendingFadeClick();
  if (activeFadeCleanup) {
    activeFadeCleanup();
    activeFadeCleanup = null;
  }
});

const canEditVolume = computed(
  () => props.canEdit && !props.clip.locked && !props.track.locked && !props.isMobile,
);

function onVolumeLinePointerDown(event: PointerEvent) {
  // Only the primary button starts a volume drag. Right / middle clicks must
  // fall through untouched so the clip's own context menu opens as it does on
  // any other part of the clip.
  if (event.button !== 0 || !canEditVolume.value) return;
  event.stopPropagation();
  event.preventDefault();
  emit('startResizeVolume', event, props.clip.audioGain ?? 1);
}

function onVolumeLineDblClick(event: MouseEvent) {
  if (!canEditVolume.value) return;
  event.stopPropagation();
  event.preventDefault();
  emit('resetVolume');
}

const volumeY = computed(() => {
  return clipGainToYPercent(props.clip.audioGain ?? 1);
});

const isIndicatorVisible = computed(() => {
  if (props.clipWidthPx < 48) return false;
  return true;
});

const isLabelAbove = computed(() => {
  const lineYPx = (volumeY.value / 100) * props.trackHeight;
  const spaceAbove = lineYPx;
  const spaceBelow = props.trackHeight - lineYPx;
  return spaceAbove >= spaceBelow;
});

const volumeIcon = computed(() => {
  const isMuted = props.clip.audioMuted;
  const gain = props.clip.audioGain ?? 1;
  const roundedVolume = Math.round(gain * 100);

  if (isMuted || roundedVolume === 0) {
    return 'i-heroicons-speaker-x-mark';
  }
  return 'i-heroicons-speaker-wave';
});

const volumeIndicatorPosition = computed(() => {
  const finalX = computeClipCenteredOverlayLeftPx({
    clipStartPx: timeUsToPx(props.item.timelineRange.startUs, props.zoom),
    clipWidthPx: props.clipWidthPx,
    scrollLeft: props.scrollLeft,
    viewportWidth: props.viewportWidth,
    paddingPx: 24, // keep the plate within the clip boundaries
  });
  return { left: `${finalX}px` };
});
</script>

<template>
  <div
    v-if="!shouldCollapseFades()"
    class="absolute left-0 right-0 pointer-events-none"
    :style="{
      zIndex: 'calc(var(--z-clip-trim) + 10)',
      top: `${topInsetPx ?? 0}px`,
      bottom: `${bottomInsetPx ?? 0}px`,
    }"
  >
    <!-- Fade Paths -->
    <div class="absolute inset-0 rounded overflow-hidden">
      <svg
        v-if="
          (clip.audioFadeInUs ?? 0) > 0 &&
          (clip.audioFadeInUs ?? 0) <= item.timelineRange.durationUs
        "
        data-testid="fade-shape-in"
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
        data-testid="fade-shape-out"
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
  </div>

  <!-- Keep fade handles in their own stacking root above full-height trim
       handles while the fade shapes remain below trim. -->
  <div
    v-if="
      !shouldCollapseFades() &&
      canEdit &&
      !clip.locked &&
      !track.locked &&
      !isMobile &&
      !hideFadeHandles
    "
    data-testid="fade-handles-layer"
    class="absolute left-0 right-0 pointer-events-none"
    :style="{
      zIndex: 'calc(var(--z-clip-handles) + 1)',
      top: `${topInsetPx ?? 0}px`,
      bottom: `${bottomInsetPx ?? 0}px`,
    }"
  >
    <div
      data-testid="fade-handle-in"
      class="absolute top-0 w-4 h-4 -translate-x-1/2 -translate-y-1/2 transition-opacity flex items-center justify-center shadow-sm pointer-events-auto touch-none coarse-reveal"
      :class="[
        clipWidthPx >= 30 ? 'cursor-pointer' : 'hidden pointer-events-none',
        'opacity-0 group-hover/clip:opacity-100',
      ]"
      :style="{
        left: `${getFadeHandlePositionPx('in')}px`,
        zIndex: 'var(--z-clip-handles)',
      }"
      @pointerdown.stop="
        onFadeHandlePointerDown($event, { edge: 'in', durationUs: clip.audioFadeInUs || 0 })
      "
      @dblclick.stop="onFadeHandleDblClick($event, 'in')"
      @click.stop
    >
      <div
        class="w-2.5 h-2.5 rounded-full bg-white border border-black/30 hover:bg-yellow-400 transition-colors"
      ></div>
    </div>

    <div
      data-testid="fade-handle-out"
      class="absolute top-0 w-4 h-4 -translate-x-1/2 -translate-y-1/2 transition-opacity flex items-center justify-center shadow-sm pointer-events-auto touch-none coarse-reveal"
      :class="[
        clipWidthPx >= 30 ? 'cursor-pointer' : 'hidden pointer-events-none',
        'opacity-0 group-hover/clip:opacity-100',
      ]"
      :style="{
        left: `${getFadeHandlePositionPx('out')}px`,
        zIndex: 'var(--z-clip-handles)',
      }"
      @pointerdown.stop="
        onFadeHandlePointerDown($event, { edge: 'out', durationUs: clip.audioFadeOutUs || 0 })
      "
      @dblclick.stop="onFadeHandleDblClick($event, 'out')"
      @click.stop
    >
      <div
        class="w-2.5 h-2.5 rounded-full bg-white border border-black/30 hover:bg-yellow-400 transition-colors"
      ></div>
    </div>
  </div>

  <!-- Volume Control Line — kept in its own stacking root *below* the trim
       handles (unlike the fade shapes/handles above) so the horizontal volume
       line never covers the trim grips at the clip edges. -->
  <div
    v-if="!shouldCollapseFades() && trackHeight >= 35"
    class="absolute left-0 right-0 pointer-events-none"
    :style="{
      zIndex: 'calc(var(--z-clip-trim) - 5)',
      top: `${topInsetPx ?? 0}px`,
      bottom: `${bottomInsetPx ?? 0}px`,
    }"
  >
    <div
      data-testid="clip-volume-control"
      class="absolute left-0 right-0 h-3 -mt-1.5 flex flex-col justify-center transition-opacity touch-none"
      :class="[
        canEditVolume && isSelected
          ? 'cursor-ns-resize pointer-events-auto'
          : 'pointer-events-none',
        clip.audioMuted || ((clip.audioGain ?? 1) === 1 && !isResizingVolume && !isSelected)
          ? 'opacity-0'
          : 'opacity-100',
        isDragging && !isResizingVolume ? 'opacity-0! pointer-events-none' : '',
      ]"
      :style="{ top: `${volumeY}%` }"
      @pointerdown="onVolumeLinePointerDown"
      @dblclick="onVolumeLineDblClick"
    >
      <div
        v-if="!isMobile"
        class="w-full bg-yellow-400 opacity-80"
        :class="[clipWidthPx >= 15 ? 'opacity-100' : 'hidden', 'h-[1.5px]']"
      ></div>

      <div
        v-if="isIndicatorVisible"
        class="absolute -translate-x-1/2 text-2xs font-mono text-yellow-400 leading-none py-0.5 bg-black/60 px-1.5 rounded pointer-events-none select-none transition-opacity opacity-100 flex items-center gap-1"
        :class="[isLabelAbove ? 'bottom-full mb-0.5' : 'top-full mt-0.5']"
        :style="volumeIndicatorPosition"
      >
        <UIcon :name="volumeIcon" class="w-3 h-3 shrink-0" />
        <span>{{ clip.audioMuted ? 0 : Math.round((clip.audioGain ?? 1) * 100) }}%</span>
      </div>
    </div>
  </div>
</template>
