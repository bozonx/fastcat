<script setup lang="ts">
import { computed, ref } from 'vue';
import type { TimelineClipItem, TimelineTrack, TimelineTrackItem } from '~/timeline/types';
import { timeUsToPx, zoomToPxPerSecond } from '~/utils/timeline/geometry';
import { clipHasAudio, isAudio, isVideo } from '~/utils/timeline/clip';
import TimelineClipPreviewOverlays from './TimelineClipPreviewOverlays.vue';
import TimelineClipThumbnails from './TimelineClipThumbnails.vue';
import TimelineAudioWaveform from './audio/TimelineAudioWaveform.vue';
import { useWorkspaceStore } from '~/stores/workspace.store';

const { t } = useI18n();

const workspaceStore = useWorkspaceStore();
const clipThumbnailMode = computed(() => workspaceStore.userSettings.ui.clipThumbnailMode);

const isKeyframesExpanded = ref(false);

interface ClipPreviewOverlay {
  rangeStyle: Record<string, string>;
  direction: string;
  timecode: string;
  hasSourceRange: boolean;
}

interface SlipOverlayView extends ClipPreviewOverlay {
  deltaClass: string;
}

const MIN_WAVEFORM_WIDTH_PX = 30;
const MIN_WAVEFORM_PX_PER_SECOND = 2.5;

defineProps<{
  item: TimelineTrackItem;
  track: TimelineTrack;
  clipItem: TimelineClipItem | null;
  effectiveClipItem: TimelineClipItem | null;
  effectiveTimelineStartUs: number;
  clipWidthPx: number;
  zoom: number;
  scrollLeft: number;
  viewportWidth: number;
  mediaMetadata: Record<string, unknown>;
  slipOverlay: SlipOverlayView | null;
  trimOverlay: ClipPreviewOverlay | null;
  transitionInOverlayGuideStyle: Record<string, string> | null;
  transitionOutOverlayGuideStyle: Record<string, string> | null;
}>();
</script>

<template>
  <div
    class="flex-1 flex flex-col w-full min-h-0 relative"
    :style="{ zIndex: 'var(--z-clip-content)' }"
  >
    <!-- Top Clip Header Bar -->
    <div
      v-if="clipItem"
      class="h-5 flex items-center justify-between px-1.5 bg-black/60 backdrop-blur-xs border-b border-white/10 text-2xs select-none shrink-0 pointer-events-auto rounded-t overflow-hidden"
      :style="{ zIndex: 'var(--z-clip-name)' }"
    >
      <div class="flex items-center gap-1 min-w-0 max-w-[calc(100%-22px)]">
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

      <button
        type="button"
        class="p-0.5 rounded transition-colors flex items-center justify-center shrink-0"
        :class="
          isKeyframesExpanded
            ? 'text-amber-400 bg-amber-400/20'
            : 'text-white/40 hover:text-white/90 hover:bg-white/10'
        "
        :title="t('fastcat.timeline.keyframesTitle')"
        @pointerdown.stop
        @click.stop="isKeyframesExpanded = !isKeyframesExpanded"
      >
        <svg class="w-2.5 h-2.5 fill-current" viewBox="0 0 24 24">
          <path d="M12 2L2 12l10 10 10-10L12 2z" />
        </svg>
      </button>
    </div>

    <!-- Main Content (Thumbnails / Waveform) -->
    <div class="flex-1 flex w-full min-h-0 relative">
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
        :clip-start-px="timeUsToPx(effectiveTimelineStartUs, zoom)"
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

    <!-- Collapsible Keyframes Block -->
    <div
      v-if="isKeyframesExpanded"
      class="h-5 w-full bg-slate-950/85 border-t border-amber-500/40 px-1.5 flex items-center justify-between text-[10px] text-amber-200/90 shrink-0 select-none pointer-events-auto rounded-b"
      :style="{ zIndex: 'var(--z-clip-content)' }"
    >
      <div class="flex items-center gap-1.5 min-w-0">
        <span class="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"></span>
        <span class="truncate font-mono text-[9px] tracking-tight uppercase opacity-90">
          {{ t('fastcat.timeline.keyframesLane') }}
        </span>
      </div>
      <div class="flex items-center gap-1 opacity-70 text-[9px]">
        <svg class="w-2 h-2 fill-current text-amber-400" viewBox="0 0 24 24">
          <path d="M12 2L2 12l10 10 10-10L12 2z" />
        </svg>
      </div>
    </div>
  </div>
</template>
