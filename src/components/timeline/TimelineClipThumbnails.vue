<script setup lang="ts">
import { computed } from 'vue';
import type { TimelineClipItem } from '~/timeline/types';
import { useTimelineClipThumbnails } from '~/composables/timeline/useTimelineClipThumbnails';

const props = defineProps<{
  item: TimelineClipItem;
  width: number;
}>();

const itemRef = computed(() => props.item);

const { chunks, imageUrl, isImage, rootEl, setChunkCanvas, setChunkEl, trimOffsetPx } =
  useTimelineClipThumbnails({ item: itemRef });

const chunksWidthPx = computed(() => {
  return chunks.value.reduce((sum, c) => sum + c.widthPx, 0);
});
</script>

<template>
  <div
    ref="rootEl"
    class="absolute inset-0 overflow-hidden pointer-events-none rounded opacity-90 select-none z-0"
  >
    <!-- Video clips: Chunked canvases -->
    <div
      class="absolute inset-y-0 h-full flex"
      :class="{ hidden: isImage }"
      :style="{
        left: `${-trimOffsetPx}px`,
        width: `${chunksWidthPx}px`,
      }"
    >
      <div
        v-for="chunk in chunks"
        :key="chunk.chunkIndex"
        :ref="(el) => setChunkEl(el, chunk.chunkIndex)"
        class="relative h-full flex-none overflow-hidden"
        :data-chunk-index="chunk.chunkIndex"
        :style="{
          width: `${chunk.widthPx}px`,
        }"
      >
        <canvas
          :ref="(el) => setChunkCanvas(el, chunk.chunkIndex)"
          class="absolute top-0 left-0 h-full max-w-none"
        ></canvas>
      </div>
    </div>

    <!-- Image clips: Centered image taking full height -->
    <div v-if="isImage" class="absolute inset-0 flex items-center justify-center overflow-hidden">
      <img
        v-if="imageUrl"
        :src="imageUrl"
        alt="clip thumbnail"
        class="h-full w-full object-cover object-center"
      />
    </div>
  </div>
</template>
