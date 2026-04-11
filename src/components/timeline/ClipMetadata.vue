<script setup lang="ts">
import { computed } from 'vue';
import type { TimelineTrack, TimelineTrackItem, TimelineClipItem } from '~/timeline/types';

const props = defineProps<{
  item: TimelineTrackItem;
  track: TimelineTrack;
  isMediaMissing?: boolean;
  isUnsupported?: boolean;
  clipWidthPx: number;
}>();

const { t } = useI18n();

const clipItem = computed(() =>
  props.item.kind === 'clip' ? (props.item as TimelineClipItem) : null,
);
</script>

<template>
  <div class="absolute inset-x-0 top-0 h-full pointer-events-none rounded overflow-hidden">
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
      <div v-if="clipItem.audioMuted" class="bg-black/30 rounded-full p-1.5">
        <UIcon name="i-heroicons-speaker-x-mark" class="w-6 h-6 text-white/90" />
      </div>
      <div v-else-if="clipItem.disabled" class="bg-black/30 rounded-full p-1">
        <UIcon
          :name="track.kind === 'audio' ? 'i-heroicons-speaker-x-mark' : 'i-heroicons-eye-slash'"
          class="w-4 h-4 text-white/80"
        />
      </div>
    </div>
  </div>
</template>
