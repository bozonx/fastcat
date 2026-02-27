<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue';
import type { TimelineClipItem } from '~/timeline/types';
import { thumbnailGenerator, getClipThumbnailsHash } from '~/utils/thumbnail-generator';
import { useTimelineStore } from '~/stores/timeline.store';
import { timeUsToPx } from '~/composables/timeline/useTimelineInteraction';
import { TIMELINE_CLIP_THUMBNAILS } from '~/utils/constants';

const props = defineProps<{
  item: TimelineClipItem;
  width: number;
}>();

const timelineStore = useTimelineStore();
const thumbnails = ref<{ time: number; url: string }[]>([]);
const isGenerating = ref(false);

// Path to the file or Object URL. We assume `item.source.path` can be used.
const fileUrl = computed(() => {
  if (props.item.clipType === 'media' && props.item.source) {
    return props.item.source.path;
  }
  return '';
});

// Duration in seconds
const duration = computed(() => {
  return (props.item.sourceDurationUs || 0) / 1000000;
});

// Hash for this clip's source
const clipHash = computed(() => {
  return fileUrl.value ? getClipThumbnailsHash(fileUrl.value) : '';
});

const generate = () => {
  if (!fileUrl.value || duration.value <= 0 || !clipHash.value) return;

  isGenerating.value = true;
  
  // Clear old thumbnails if generating new
  if (thumbnails.value.length === 0) {
    // We could load existing ones, but for now we rely on the generator to send progress
  }

  thumbnailGenerator.addTask({
    id: clipHash.value,
    projectRelativePath: fileUrl.value,
    duration: duration.value,
    onProgress: (progress, path, time) => {
      // Add if not exists
      if (!thumbnails.value.find(t => t.time === time)) {
        thumbnails.value.push({ time, url: path });
        thumbnails.value.sort((a, b) => a.time - b.time);
      }
    },
    onComplete: () => {
      isGenerating.value = false;
    },
    onError: (err) => {
      console.error('Thumbnail generation error:', err);
      isGenerating.value = false;
    }
  });
};

onMounted(() => {
  if (props.item.clipType === 'media') {
    generate();
  }
});

onUnmounted(() => {
  // Мы больше не удаляем ObjectURL здесь, так как они кэшируются в thumbnailGenerator
  // и могут быть переиспользованы, если компонент будет снова смонтирован.
  // Очистку должен делать стор при удалении клипа из проекта.
});

watch(fileUrl, () => {
  thumbnails.value = [];
  generate();
});

// Calculate thumbnail width based on current zoom
const pxPerThumbnail = computed(() => {
  return timeUsToPx(TIMELINE_CLIP_THUMBNAILS.INTERVAL_SECONDS * 1000000, timelineStore.timelineZoom);
});

// Offset for trim start
const trimOffsetPx = computed(() => {
  return timeUsToPx(props.item.sourceRange.startUs, timelineStore.timelineZoom);
});

</script>

<template>
  <div 
    class="absolute inset-0 overflow-hidden rounded opacity-60 pointer-events-none select-none flex"
    v-if="item.clipType === 'media' && fileUrl"
  >
    <div 
      class="flex h-full relative"
      :style="{ transform: `translateX(-${trimOffsetPx}px)` }"
    >
      <div 
        v-for="thumb in thumbnails" 
        :key="thumb.time"
        class="h-full shrink-0 relative bg-black/20"
        :style="{ width: `${pxPerThumbnail}px` }"
      >
        <img 
          :src="thumb.url" 
          class="absolute inset-0 w-full h-full object-cover"
          loading="lazy"
        />
      </div>
    </div>
  </div>
</template>
