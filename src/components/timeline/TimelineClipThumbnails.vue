<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, computed, nextTick } from 'vue';
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
const isGenerating = ref(false);

const rootEl = ref<HTMLElement | null>(null);

const intervalSeconds = TIMELINE_CLIP_THUMBNAILS.INTERVAL_SECONDS;
const intervalUs = intervalSeconds * 1_000_000;

const thumbnailsBySecond = ref(new Map<number, string>());
const imagePromisesByUrl = new Map<string, Promise<HTMLImageElement>>();

const chunkEls = ref<(HTMLElement | null)[]>([]);
const chunkCanvases = ref<(HTMLCanvasElement | null)[]>([]);
const visibleChunks = ref(new Set<number>());
let chunkObserver: IntersectionObserver | null = null;
let resizeObserver: ResizeObserver | null = null;

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

  thumbnailGenerator.addTask({
    id: clipHash.value,
    projectRelativePath: fileUrl.value,
    duration: duration.value,
    onProgress: (progress, path, time) => {
      const secondKey = Math.round(time);
      const newMap = new Map(thumbnailsBySecond.value);
      if (!newMap.has(secondKey)) {
        newMap.set(secondKey, path);
        thumbnailsBySecond.value = newMap;
      }

      const idx = Math.floor(secondKey / intervalSeconds);
      const chunkIndex = getChunkIndexByThumbIndex(idx);
      if (chunkIndex !== null && visibleChunks.value.has(chunkIndex)) {
        void drawChunk(chunkIndex);
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

onBeforeUnmount(() => {
  chunkObserver?.disconnect();
  chunkObserver = null;
  resizeObserver?.disconnect();
  resizeObserver = null;
  visibleChunks.value.clear();
});

watch(fileUrl, () => {
  thumbnailsBySecond.value = new Map();
  generate();
});

// Calculate thumbnail width based on current zoom
const pxPerThumbnail = computed(() => {
  return timeUsToPx(intervalUs, timelineStore.timelineZoom);
});

// Offset for trim start
const trimOffsetPx = computed(() => {
  return timeUsToPx(props.item.sourceRange.startUs, timelineStore.timelineZoom);
});

const totalThumbs = computed(() => {
  if (!duration.value || duration.value <= 0) return 0;
  return Math.max(0, Math.ceil(duration.value / intervalSeconds));
});

const thumbsPerChunk = computed(() => {
  const px = pxPerThumbnail.value;
  if (!Number.isFinite(px) || px <= 0) return 20;
  const chunkMaxPx = 3072;
  const raw = Math.floor(chunkMaxPx / px);
  return Math.max(8, Math.min(120, raw));
});

const chunks = computed(() => {
  const total = totalThumbs.value;
  const perChunk = thumbsPerChunk.value;
  const px = pxPerThumbnail.value;
  if (total === 0 || perChunk <= 0 || !Number.isFinite(px) || px <= 0) return [];

  const count = Math.ceil(total / perChunk);
  return Array.from({ length: count }, (_, chunkIndex) => {
    const startThumbIndex = chunkIndex * perChunk;
    const endThumbIndex = Math.min(total, startThumbIndex + perChunk);
    const thumbsCount = Math.max(0, endThumbIndex - startThumbIndex);
    const widthPx = thumbsCount * px;
    return {
      chunkIndex,
      startThumbIndex,
      endThumbIndex,
      thumbsCount,
      widthPx,
    };
  });
});

function getChunkIndexByThumbIndex(thumbIndex: number): number | null {
  if (!Number.isFinite(thumbIndex) || thumbIndex < 0) return null;
  const perChunk = thumbsPerChunk.value;
  if (!Number.isFinite(perChunk) || perChunk <= 0) return null;
  return Math.floor(thumbIndex / perChunk);
}

function setChunkEl(el: unknown, chunkIndex: number) {
  chunkEls.value[chunkIndex] = el instanceof HTMLElement ? el : null;
}

function setChunkCanvas(el: unknown, chunkIndex: number) {
  chunkCanvases.value[chunkIndex] = el instanceof HTMLCanvasElement ? el : null;
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const existing = imagePromisesByUrl.get(url);
  if (existing) return existing;

  const p = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.loading = 'eager';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load thumbnail image'));
    img.src = url;
  });
  imagePromisesByUrl.set(url, p);
  return p;
}

function drawImageCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const imgRatio = img.width / img.height;
  const targetRatio = w / h;
  let sx = 0, sy = 0, sw = img.width, sh = img.height;
  if (imgRatio > targetRatio) {
    sw = img.height * targetRatio;
    sx = (img.width - sw) / 2;
  } else {
    sh = img.width / targetRatio;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

async function drawChunk(chunkIndex: number) {
  const chunk = chunks.value.find((c) => c.chunkIndex === chunkIndex);
  if (!chunk) return;
  const canvas = chunkCanvases.value[chunkIndex];
  const root = rootEl.value;
  if (!canvas || !root) return;

  const cssHeight = Math.max(1, canvas.parentElement?.clientHeight || root.clientHeight);
  const cssWidth = Math.max(1, Math.round(chunk.widthPx));

  const dpr = window.devicePixelRatio || 1;
  const targetWidth = Math.max(1, Math.round(cssWidth * dpr));
  const targetHeight = Math.max(1, Math.round(cssHeight * dpr));
  if (canvas.width !== targetWidth) canvas.width = targetWidth;
  if (canvas.height !== targetHeight) canvas.height = targetHeight;
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = true;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const px = pxPerThumbnail.value;
  if (!Number.isFinite(px) || px <= 0) return;

  for (let i = 0; i < chunk.thumbsCount; i++) {
    const thumbIndex = chunk.startThumbIndex + i;
    const secondKey = thumbIndex * intervalSeconds;
    const url = thumbnailsBySecond.value.get(secondKey);
    if (!url) continue;

    try {
      const img = await loadImage(url);
      const xCss = i * px;
      const wCss = px;
      drawImageCover(
        ctx, img,
        Math.round(xCss * dpr),
        0,
        Math.max(1, Math.round(wCss * dpr)),
        canvas.height
      );
    } catch {
      // ignore
    }
  }
}

async function redrawVisibleChunks() {
  await nextTick();
  const toDraw = Array.from(visibleChunks.value.values());
  for (const idx of toDraw) {
    await drawChunk(idx);
  }
}

watch([chunks, pxPerThumbnail], () => {
  void nextTick().then(() => {
    chunkObserver?.disconnect();
    visibleChunks.value.clear();

    chunkObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          const idxRaw = el.dataset['chunkIndex'];
          const idx = idxRaw ? Number(idxRaw) : NaN;
          if (!Number.isFinite(idx)) continue;

          if (entry.isIntersecting) {
            visibleChunks.value.add(idx);
            void drawChunk(idx);
          } else {
            visibleChunks.value.delete(idx);
          }
        }
      },
      {
        root: null,
        rootMargin: '200px',
        threshold: 0.01,
      },
    );

    for (const chunk of chunks.value) {
      const el = chunkEls.value[chunk.chunkIndex];
      if (el) chunkObserver.observe(el);
    }

    resizeObserver?.disconnect();
    resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        void redrawVisibleChunks();
      });
    });
    if (rootEl.value) {
      resizeObserver.observe(rootEl.value);
    }
  });
});

</script>

<template>
  <div 
    class="absolute inset-0 overflow-hidden rounded opacity-60 pointer-events-none select-none flex"
    v-if="item.clipType === 'media' && fileUrl"
    ref="rootEl"
  >
    <div 
      class="flex h-full relative"
      :style="{ transform: `translateX(-${trimOffsetPx}px)` }"
    >
      <div
        v-for="chunk in chunks"
        :key="chunk.chunkIndex"
        class="h-full shrink-0 relative"
        :style="{ width: `${chunk.widthPx}px` }"
        :data-chunk-index="chunk.chunkIndex"
        :ref="(el) => setChunkEl(el, chunk.chunkIndex)"
      >
        <canvas
          class="absolute inset-0"
          :ref="(el) => setChunkCanvas(el, chunk.chunkIndex)"
        />
      </div>
    </div>
  </div>
</template>
