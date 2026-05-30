<script setup lang="ts">
import { computed } from 'vue';
import type { TimelineClipItem, TimelineTrack, TimelineTrackItem } from '~/timeline/types';
import { timeUsToPx, zoomToPxPerSecond } from '~/utils/timeline/geometry';
import { clipHasAudio, isAudio, isVideo } from '~/utils/timeline/clip';
import TimelineClipPreviewOverlays from './TimelineClipPreviewOverlays.vue';
import TimelineClipThumbnails from './TimelineClipThumbnails.vue';
import TimelineAudioWaveform from './audio/TimelineAudioWaveform.vue';
import { useWorkspaceStore } from '~/stores/workspace.store';

const workspaceStore = useWorkspaceStore();
const clipThumbnailMode = computed(() => workspaceStore.userSettings.ui.clipThumbnailMode);

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
  <div class="flex-1 flex w-full min-h-0 relative" :style="{ zIndex: 'var(--z-clip-content)' }">
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
        (isAudio(item, track) || (isVideo(item, track) && clipHasAudio(item, track, mediaMetadata)))
      "
      :item="effectiveClipItem"
      :scroll-left="scrollLeft"
      :viewport-width="viewportWidth"
    />

    <div
      v-if="clipItem"
      class="absolute bottom-0 left-0 right-0 flex items-end justify-center px-2 pb-0.5 pointer-events-none"
      :style="{ zIndex: 'var(--z-clip-name)' }"
    >
      <span class="truncate text-2xs leading-tight opacity-70" :title="clipItem.name">
        {{ clipItem.name }}
      </span>
    </div>

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
</template>
