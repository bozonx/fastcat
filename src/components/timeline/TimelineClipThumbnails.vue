<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue';
import { useResizeObserver } from '@vueuse/core';
import type { TimelineClipItem } from '~/timeline/types';
import { useTimelineClipThumbnails } from '~/composables/timeline/useTimelineClipThumbnails';
const { t } = useI18n();
const props = defineProps<{
  item: TimelineClipItem;
  width: number;
  scrollLeft: number;
  viewportWidth: number;
  clipStartPx: number;
}>();

const containerRef = useTemplateRef<HTMLElement>('container');
const clipHeightPx = ref(0);

useResizeObserver(containerRef, (entries) => {
  clipHeightPx.value = entries[0]?.contentRect.height ?? 0;
});

const itemRef = computed(() => props.item);
const scrollLeftRef = computed(() => props.scrollLeft);
const viewportWidthRef = computed(() => props.viewportWidth);
const clipStartPxRef = computed(() => props.clipStartPx);

const { imageUrl, isImage, thumbnailTiles, trimOffsetPx } = useTimelineClipThumbnails({
  item: itemRef,
  scrollLeft: scrollLeftRef,
  viewportWidth: viewportWidthRef,
  clipStartPx: clipStartPxRef,
  clipHeightPx,
});

const thumbnailsStripWidthPx = computed(() => props.width + trimOffsetPx.value);
</script>

<template>
  <div
    ref="container"
    class="absolute inset-0 overflow-hidden pointer-events-none rounded opacity-90 select-none z-0"
  >
    <!-- Video clips: virtual img tiles -->
    <div
      v-if="!isImage"
      class="absolute inset-y-0 h-full"
      :style="{
        left: `${-trimOffsetPx}px`,
        width: `${thumbnailsStripWidthPx}px`,
      }"
    >
      <img
        v-for="tile in thumbnailTiles"
        :key="tile.key"
        :src="tile.url"
        :alt="t('fastcat.timeline.clipThumbnail')"
        class="absolute top-0 h-full object-cover object-center"
        :style="{
          left: `${tile.leftPx}px`,
          width: `${tile.widthPx}px`,
        }"
      />
    </div>

    <!-- Image clips -->
    <div v-if="isImage" class="absolute inset-0 flex items-center justify-center overflow-hidden">
      <img
        v-if="imageUrl"
        :src="imageUrl"
        :alt="t('fastcat.timeline.clipThumbnail')"
        class="h-full w-full object-cover object-center"
      />
    </div>
  </div>
</template>
