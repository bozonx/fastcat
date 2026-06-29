<script setup lang="ts">
import { computed, inject } from 'vue';
import type { TimelineTrack, TimelineTrackItem, TimelineClipItem } from '~/timeline/types';
import type { TimelineContext } from './context';
import { isClipFreePosition } from '~/utils/timeline/clip-checks';

const props = defineProps<{
  item: TimelineTrackItem;
  track: TimelineTrack;
  isMediaMissing?: boolean;
  isUnsupported?: boolean;
  clipWidthPx: number;
}>();

const { t } = useI18n();

const timelineContext = inject<TimelineContext>('timelineContext');

const clipItem = computed(() =>
  props.item.kind === 'clip' ? (props.item as TimelineClipItem) : null,
);

const isFreePosition = computed(() => {
  if (!timelineContext || !clipItem.value) return false;
  return isClipFreePosition(
    clipItem.value,
    timelineContext.timelineDoc.value,
    timelineContext.fps.value || 30,
  );
});


</script>

<template>
  <div class="absolute inset-x-0 top-0 h-full pointer-events-none rounded overflow-hidden">
    <!-- Top Right Status Indicators -->
    <div
      class="absolute top-1 right-1 flex items-center gap-1 pointer-events-none"
      :style="{ zIndex: 'var(--z-clip-free-pos)' }"
    >
      <!-- Freeze Frame Indicator -->
      <div
        v-if="clipItem && typeof clipItem.freezeFrameSourceUs === 'number'"
        class="flex items-center justify-center p-0.5 rounded bg-black/60 text-amber-400"
        :title="t('fastcat.timeline.freezeFrameTitle')"
      >
        <UIcon name="i-heroicons-pause-circle" class="w-3.5 h-3.5" />
      </div>

      <!-- Free Position Warning -->
      <div
        v-if="clipItem && isFreePosition && !isMediaMissing && !isUnsupported"
        class="flex items-center justify-center p-0.5 rounded bg-black/60 text-yellow-400"
        :title="t('fastcat.timeline.freePositionHint')"
      >
        <UIcon name="i-heroicons-exclamation-triangle" class="w-3.5 h-3.5" />
      </div>
    </div>

    <!-- Nested timeline badge: helps the user distinguish embedded sequences
         from regular media. Double-click on the clip opens the nested timeline
         (see TimelineClip.vue:278). -->
    <div
      v-if="clipItem && clipItem.clipType === 'timeline' && !isMediaMissing"
      class="absolute top-1 left-1 z-20 flex items-center gap-1 px-1 py-0.5 rounded bg-sky-600/80 text-white pointer-events-none"
      :title="t('fastcat.timeline.nestedTimelineHint')"
    >
      <UIcon name="i-heroicons-square-3-stack-3d" class="w-3 h-3" />
      <span v-if="clipWidthPx > 80" class="text-[10px] font-medium leading-none">
        {{ t('fastcat.timeline.nestedTimeline') }}
      </span>
    </div>

    <!-- Missing Media Overlay -->
    <div
      v-if="isMediaMissing"
      class="absolute inset-0 flex flex-col items-center justify-center z-30 bg-red-600/20"
    >
      <UIcon name="i-heroicons-exclamation-triangle" class="w-5 h-5 text-white mb-1" />
      <span v-if="clipWidthPx > 60" class="text-2xs font-bold uppercase tracking-wider text-white">
        {{ t('fastcat.timeline.noMedia') }}
      </span>
    </div>

    <!-- Unsupported Media Overlay -->
    <div
      v-else-if="isUnsupported"
      class="absolute inset-0 flex flex-col items-center justify-center z-30 bg-amber-600/10"
    >
      <UIcon name="i-heroicons-exclamation-circle" class="w-5 h-5 text-amber-200 mb-0.5" />
      <span
        v-if="clipWidthPx > 60"
        class="text-[10px] leading-tight font-bold uppercase tracking-wider text-amber-100 text-center px-1"
      >
        {{ t('videoEditor.fileManager.compatibility.unsupported') }}
      </span>
    </div>

    <!-- Muted / Disabled Overlay -->
    <div
      v-if="
        clipItem && (clipItem.disabled || clipItem.audioMuted) && !isMediaMissing && !isUnsupported
      "
      class="absolute inset-0 flex items-center justify-center z-30"
    >
      <div v-if="clipItem.disabled" class="bg-black/30 rounded-full p-1">
        <UIcon
          :name="track.kind === 'audio' ? 'i-heroicons-speaker-x-mark' : 'i-heroicons-eye-slash'"
          class="w-4 h-4 text-white/80"
        />
      </div>
      <div
        v-else-if="clipItem.audioMuted && !track.audioMuted"
        class="bg-black/30 rounded-full p-1.5"
      >
        <UIcon name="i-heroicons-speaker-x-mark" class="w-6 h-6 text-white/90" />
      </div>
    </div>


  </div>
</template>
