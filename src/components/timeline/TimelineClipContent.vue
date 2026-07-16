<script setup lang="ts">
import { computed } from 'vue';
import type { TimelineClipItem, TimelineTrack, TimelineTrackItem } from '~/timeline/types';
import { timeUsToPx, zoomToPxPerSecond } from '~/utils/timeline/geometry';
import { clipHasAudio, isAudio, isVideo } from '~/utils/timeline/clip';
import { animatedParamPaths } from '~/timeline/animation/ops';
import TimelineClipPreviewOverlays from './TimelineClipPreviewOverlays.vue';
import TimelineClipThumbnails from './TimelineClipThumbnails.vue';
import TimelineAudioWaveform from './audio/TimelineAudioWaveform.vue';
import TimelineClipCurveEditor from './TimelineClipCurveEditor.vue';
import TimelineClipKeyframeLane from './TimelineClipKeyframeLane.vue';
import { useWorkspaceStore } from '~/stores/workspace.store';

const { t } = useI18n();

const workspaceStore = useWorkspaceStore();
const clipThumbnailMode = computed(() => workspaceStore.userSettings.ui.clipThumbnailMode);

// Expanded state lives in the parent (TimelineClip) so trim handles and fades
// can react to it and stay constrained to the content band.
const isKeyframesExpanded = defineModel<boolean>('keyframesExpanded', { default: false });

// Shared diamond glyph used both by the toggle button and the lane marker.
const KEYFRAME_DIAMOND_PATH = 'M12 2L2 12l10 10 10-10L12 2z';

// The keyframes lane can only be shown when there is a content band below the
// header to attach it to.
const isKeyframesLaneVisible = computed(() => isKeyframesExpanded.value && !props.isHeaderOnly);

const hasAnimatedParams = computed(() => animatedParamPaths(props.clipItem?.animations).length > 0);

interface ClipPreviewOverlay {
  rangeStyle: Record<string, string>;
  direction: string;
  timecode: string;
  hasSourceRange: boolean;
  showSourceRange: boolean;
}

interface SlipOverlayView extends ClipPreviewOverlay {
  deltaClass: string;
}

const MIN_WAVEFORM_WIDTH_PX = 30;
const MIN_WAVEFORM_PX_PER_SECOND = 2.5;

const props = defineProps<{
  item: TimelineTrackItem;
  track: TimelineTrack;
  clipItem: TimelineClipItem | null;
  /** When true the clip is too short for a content band: only the header shows. */
  isHeaderOnly: boolean;
  effectiveClipItem: TimelineClipItem | null;
  effectiveTimelineStartTicks: number;
  clipWidthPx: number;
  zoom: number;
  scrollLeft: number;
  viewportWidth: number;
  mediaMetadata: Record<string, unknown>;
  slipOverlay: SlipOverlayView | null;
  trimOverlay: ClipPreviewOverlay | null;
  transitionInOverlayGuideStyle: Record<string, string> | null;
  transitionOutOverlayGuideStyle: Record<string, string> | null;
  canAddTransitionIn?: boolean;
  canAddTransitionOut?: boolean;
  showHeaderActions?: boolean;
}>();

const emit = defineEmits<{
  addTransition: [edge: 'in' | 'out'];
}>();

const toolbarWidth = computed(() => {
  let numButtons = 1; // Keyframes button is always present
  if (props.canAddTransitionIn) numButtons++;
  if (props.canAddTransitionOut) numButtons++;
  return numButtons * 16 + (numButtons > 1 ? (numButtons - 1) * 2 : 0);
});

const toolbarStyle = computed(() => {
  if (props.isHeaderOnly) return {};

  const zoom = props.zoom;
  const scrollLeft = props.scrollLeft;
  const viewportWidth = props.viewportWidth;
  const clipWidthPx = props.clipWidthPx;

  const clipLeftPx = Math.round(timeUsToPx(props.effectiveTimelineStartTicks, zoom));
  const clipRightPx = clipLeftPx + clipWidthPx;
  const viewportRightPx = scrollLeft + viewportWidth;

  const width = toolbarWidth.value;
  // We want the toolbar to stay visible. Its right edge should be at min(clipRightPx, viewportRightPx).
  // But it must not shift past the left edge of the clip (clipLeftPx) plus its own width + padding/gap.
  const idealRightPx = Math.max(clipLeftPx + width + 8, Math.min(clipRightPx, viewportRightPx));
  const offsetPx = Math.min(0, idealRightPx - clipRightPx);

  return {
    transform: `translateX(${offsetPx}px)`,
  };
});

const titleStyle = computed(() => {
  if (props.isHeaderOnly) return {};

  const zoom = props.zoom;
  const scrollLeft = props.scrollLeft;
  const viewportWidth = props.viewportWidth;
  const clipWidthPx = props.clipWidthPx;

  const clipLeftPx = Math.round(timeUsToPx(props.effectiveTimelineStartTicks, zoom));
  const clipRightPx = clipLeftPx + clipWidthPx;
  const viewportRightPx = scrollLeft + viewportWidth;

  const width = toolbarWidth.value;
  const idealRightPx = Math.max(clipLeftPx + width + 8, Math.min(clipRightPx, viewportRightPx));
  const offsetPx = Math.min(0, idealRightPx - clipRightPx);

  if (offsetPx === 0) return {};

  // The local right edge of the toolbar is: clipWidthPx - 6 (right padding of header) + offsetPx
  // The local left edge of the toolbar is: localRightPx - width
  const localLeftPx = clipWidthPx - 6 + offsetPx - width;
  const titleStartPx = 22; // 6px padding + 12px icon + 4px gap
  const safetyGap = 8;
  const maxWidthPx = Math.max(20, localLeftPx - titleStartPx - safetyGap);

  return {
    maxWidth: `${maxWidthPx}px`,
  };
});
</script>

<template>
  <div
    class="flex-1 flex flex-col w-full min-h-0 relative"
    :style="{ zIndex: 'var(--z-clip-content)' }"
  >
    <!-- Top Clip Header Bar -->
    <!-- pointer-events-none so grabbing the header still starts a clip drag;
         only the keyframes toggle re-enables pointer events. -->
    <div
      v-if="clipItem"
      class="flex items-center justify-between px-1.5 bg-black/25 border-b border-white/10 text-2xs select-none shrink-0 pointer-events-none rounded-t overflow-hidden"
      :class="isHeaderOnly ? 'flex-1 min-h-0' : 'h-5'"
      :style="{ zIndex: 'var(--z-clip-name)' }"
    >
      <div class="flex items-center gap-1 min-w-0 flex-1" :style="titleStyle">
        <UIcon
          :name="
            isVideo(item, track)
              ? 'i-heroicons-film'
              : isAudio(item, track)
                ? 'i-heroicons-musical-note'
                : 'i-heroicons-document-text'
          "
          class="w-3 h-3 text-white/70 shrink-0"
        />
        <span
          class="truncate text-[11px] font-medium leading-none text-white/95 drop-shadow-xs"
          :title="clipItem.name"
        >
          {{ clipItem.name }}
        </span>
      </div>

      <div
        v-if="!isHeaderOnly"
        class="flex items-center gap-0.5 shrink-0 pointer-events-auto transition-opacity"
        :class="showHeaderActions ? 'opacity-100' : 'opacity-0 group-hover/clip:opacity-100'"
        :style="{
          zIndex: 'calc(var(--z-clip-trim) + 1)',
          ...toolbarStyle,
        }"
      >
        <UiTooltip v-if="canAddTransitionIn" :text="t('fastcat.timeline.addTransitionIn')">
          <button
            data-testid="clip-add-transition-in"
            type="button"
            class="size-4 rounded flex items-center justify-center text-white/55 hover:text-white hover:bg-white/10 transition-colors"
            :aria-label="t('fastcat.timeline.addTransitionIn')"
            @pointerdown.stop
            @click.stop="emit('addTransition', 'in')"
          >
            <UIcon name="i-heroicons-arrow-left-end-on-rectangle" class="size-3" />
          </button>
        </UiTooltip>

        <UiTooltip v-if="canAddTransitionOut" :text="t('fastcat.timeline.addTransitionOut')">
          <button
            data-testid="clip-add-transition-out"
            type="button"
            class="size-4 rounded flex items-center justify-center text-white/55 hover:text-white hover:bg-white/10 transition-colors"
            :aria-label="t('fastcat.timeline.addTransitionOut')"
            @pointerdown.stop
            @click.stop="emit('addTransition', 'out')"
          >
            <UIcon name="i-heroicons-arrow-right-end-on-rectangle" class="size-3" />
          </button>
        </UiTooltip>

        <!-- Sits above the trim handles (z > --z-clip-trim) so it stays clickable
             even where a handle overlaps it. -->
        <button
          type="button"
          class="size-4 rounded transition-colors flex items-center justify-center shrink-0"
          :class="
            isKeyframesExpanded
              ? 'text-amber-400 bg-amber-400/20'
              : 'text-white/40 hover:text-white/90 hover:bg-white/10'
          "
          :title="t('fastcat.timeline.keyframesTitle')"
          :aria-label="t('fastcat.timeline.keyframesTitle')"
          :aria-pressed="isKeyframesExpanded"
          @pointerdown.stop
          @click.stop="isKeyframesExpanded = !isKeyframesExpanded"
        >
          <svg class="size-2.5 fill-current" viewBox="0 0 24 24">
            <path :d="KEYFRAME_DIAMOND_PATH" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Main Content (Thumbnails / Waveform) -->
    <div v-if="!isHeaderOnly" class="flex-1 flex w-full min-h-0 relative">
      <TimelineClipThumbnails
        v-if="
          effectiveClipItem &&
          isVideo(item, track) &&
          effectiveClipItem.showThumbnails !== false &&
          clipThumbnailMode !== 'none'
        "
        :item="effectiveClipItem"
        :width="clipWidthPx"
        :scroll-left="scrollLeft"
        :viewport-width="viewportWidth"
        :clip-start-px="timeUsToPx(effectiveTimelineStartTicks, zoom)"
      />
      <TimelineAudioWaveform
        v-if="
          effectiveClipItem &&
          effectiveClipItem.showWaveform !== false &&
          zoomToPxPerSecond(zoom) >= MIN_WAVEFORM_PX_PER_SECOND &&
          clipWidthPx >= MIN_WAVEFORM_WIDTH_PX &&
          (isAudio(item, track) ||
            (isVideo(item, track) && clipHasAudio(item, track, mediaMetadata)))
        "
        :item="effectiveClipItem"
        :scroll-left="scrollLeft"
        :viewport-width="viewportWidth"
      />

      <TimelineClipPreviewOverlays :slip-overlay="slipOverlay" :trim-overlay="trimOverlay" />

      <div
        v-if="transitionInOverlayGuideStyle"
        class="absolute top-0 bottom-0 w-0 border-l-2 border-dashed border-yellow-400/95 pointer-events-none"
        :style="{ ...transitionInOverlayGuideStyle, zIndex: 'var(--z-clip-guide)' }"
      />

      <div
        v-if="transitionOutOverlayGuideStyle"
        class="absolute top-0 bottom-0 w-0 border-l-2 border-dashed border-cyan-400/95 pointer-events-none"
        :style="{ ...transitionOutOverlayGuideStyle, zIndex: 'var(--z-clip-guide)' }"
      />
    </div>

    <!-- Collapsible Keyframes Lane + Curve Editor -->
    <div
      v-if="isKeyframesLaneVisible"
      class="h-[76px] w-full bg-slate-950/85 border-t border-amber-500/40 shrink-0 select-none pointer-events-auto rounded-b overflow-hidden"
      :style="{ zIndex: 'var(--z-clip-content)' }"
    >
      <template v-if="hasAnimatedParams && clipItem">
        <div class="h-5 border-b border-white/10">
          <TimelineClipKeyframeLane :clip="clipItem" :track-id="track.id" :zoom="zoom" />
        </div>
        <div class="h-14">
          <TimelineClipCurveEditor :clip="clipItem" :track-id="track.id" :zoom="zoom" />
        </div>
      </template>
      <div v-else class="h-full w-full flex items-center px-1.5 text-[10px] text-amber-200/60">
        <span class="truncate font-mono text-[9px] tracking-tight uppercase opacity-80">
          {{ t('fastcat.timeline.keyframesLaneEmptyHint') }}
        </span>
      </div>
    </div>
  </div>
</template>
