<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import { useMediaStore } from '~/stores/media.store';
import { timeUsToPx } from '~/composables/timeline/useTimelineInteraction';
import { getAudioEngine } from '~/utils/video-editor/worker-client';
import type { TimelineClipItem } from '~/timeline/types';

const props = defineProps<{
  item: TimelineClipItem;
}>();

const timelineStore = useTimelineStore();
const projectStore = useProjectStore();
const mediaStore = useMediaStore();

const rootEl = ref<HTMLElement | null>(null);
const chunkEls = ref<(HTMLElement | null)[]>([]);
const chunkCanvases = ref<(HTMLCanvasElement | null)[]>([]);
const visibleChunks = ref(new Set<number>());

let chunkObserver: IntersectionObserver | null = null;
let resizeObserver: ResizeObserver | null = null;

const fileUrl = computed(() => {
  if (props.item.source) {
    return props.item.source.path;
  }
  return '';
});

// Audio peaks caching
// peaks[channel][sample]
const audioPeaks = ref<number[][] | null>(null);
const isExtracting = ref(false);

const extractPeaks = async () => {
  if (!fileUrl.value || !projectStore.currentProjectId) return;
  if (audioPeaks.value || isExtracting.value) return;

  try {
    isExtracting.value = true;
    const fileHandle = await projectStore.getFileHandleByPath(fileUrl.value);
    if (!fileHandle) return;

    const engine = await getAudioEngine();
    if (!engine) return;

    // Use a fixed max length that represents a reasonable resolution (e.g., 8000 samples per second of audio max, or just a fixed large number)
    // Actually, for a timeline, we need enough resolution for the maximum zoom level.
    // If we assume max zoom is 1000px per second, 8000 is plenty.
    const durationS = (props.item.sourceDurationUs || 0) / 1_000_000;
    const samplesPerSecond = 1000; // Adjust based on required visual resolution
    const maxLength = Math.max(8000, Math.ceil(durationS * samplesPerSecond));

    const peaks = await engine.extractPeaks(fileHandle, fileUrl.value, {
      maxLength,
      precision: 10000,
    });

    if (peaks) {
      audioPeaks.value = peaks;
      void redrawMountedChunks();
    }
  } catch (err) {
    console.error('Failed to extract audio peaks:', err);
  } finally {
    isExtracting.value = false;
  }
};

watch(fileUrl, () => {
  audioPeaks.value = null;
  void extractPeaks();
}, { immediate: true });

onMounted(() => {
  void extractPeaks();
});

onBeforeUnmount(() => {
  chunkObserver?.disconnect();
  chunkObserver = null;
  resizeObserver?.disconnect();
  resizeObserver = null;
  visibleChunks.value.clear();
});

const trimOffsetPx = computed(() => {
  return timeUsToPx(props.item.sourceRange.startUs, timelineStore.timelineZoom);
});

const durationUs = computed(() => props.item.sourceDurationUs || 0);

// Chunking logic (similar to video thumbnails but for waveform rendering)
const CHUNK_WIDTH_PX = 1000; // Fixed chunk width in pixels for canvas

const totalWidthPx = computed(() => {
  return timeUsToPx(durationUs.value, timelineStore.timelineZoom);
});

const chunks = computed(() => {
  const totalW = totalWidthPx.value;
  if (totalW <= 0) return [];

  const count = Math.ceil(totalW / CHUNK_WIDTH_PX);
  return Array.from({ length: count }, (_, chunkIndex) => {
    const isLast = chunkIndex === count - 1;
    const widthPx = isLast ? totalW - chunkIndex * CHUNK_WIDTH_PX : CHUNK_WIDTH_PX;
    const startPx = chunkIndex * CHUNK_WIDTH_PX;
    return {
      chunkIndex,
      widthPx,
      startPx,
    };
  });
});

function setChunkEl(el: unknown, chunkIndex: number) {
  if (!chunkEls.value) chunkEls.value = [];
  chunkEls.value[chunkIndex] = el instanceof HTMLElement ? el : null;
}

function setChunkCanvas(el: unknown, chunkIndex: number) {
  if (!chunkCanvases.value) chunkCanvases.value = [];
  chunkCanvases.value[chunkIndex] = el instanceof HTMLCanvasElement ? el : null;
}

const waveColor = '#3b82f6'; // Tailwind blue-500
const progressColor = '#2563eb'; // Tailwind blue-600

function drawChunk(chunkIndex: number) {
  const chunk = chunks.value.find((c) => c.chunkIndex === chunkIndex);
  if (!chunk) return;
  const canvas = chunkCanvases.value[chunkIndex];
  const root = rootEl.value;
  if (!canvas || !root) return;
  if (!audioPeaks.value || audioPeaks.value.length === 0) return;

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
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const peaks = audioPeaks.value[0]; // Just use first channel for now
  if (!peaks || peaks.length === 0) return;

  const totalW = totalWidthPx.value;
  
  // Calculate which portion of the peaks array falls into this chunk
  const startRatio = chunk.startPx / totalW;
  const endRatio = (chunk.startPx + chunk.widthPx) / totalW;
  
  const startIndex = Math.floor(startRatio * peaks.length);
  const endIndex = Math.min(peaks.length, Math.ceil(endRatio * peaks.length));
  
  const chunkPeaks = peaks.slice(startIndex, endIndex);
  if (chunkPeaks.length === 0) return;

  const halfH = targetHeight / 2;
  const step = targetWidth / chunkPeaks.length;

  ctx.fillStyle = waveColor;
  ctx.beginPath();
  
  // Draw top half
  ctx.moveTo(0, halfH);
  for (let i = 0; i < chunkPeaks.length; i++) {
    const x = i * step;
    const y = halfH - (Math.abs(chunkPeaks[i]) * halfH);
    ctx.lineTo(x, y);
  }
  
  // Draw bottom half (mirrored)
  for (let i = chunkPeaks.length - 1; i >= 0; i--) {
    const x = i * step;
    const y = halfH + (Math.abs(chunkPeaks[i]) * halfH);
    ctx.lineTo(x, y);
  }
  
  ctx.closePath();
  ctx.fill();
}

async function redrawVisibleChunks() {
  await nextTick();
  const toDraw = Array.from(visibleChunks.value.values());
  for (const idx of toDraw) {
    drawChunk(idx);
  }
}

async function redrawMountedChunks() {
  await nextTick();
  for (const chunk of chunks.value) {
    const canvas = chunkCanvases.value[chunk.chunkIndex];
    if (!canvas) continue;
    drawChunk(chunk.chunkIndex);
  }
}

watch(
  [chunks],
  () => {
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
              drawChunk(idx);
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
      
      void redrawMountedChunks();
    });
  },
  { immediate: true, flush: 'post' },
);

</script>

<template>
  <div
    ref="rootEl"
    class="absolute inset-0 overflow-hidden pointer-events-none rounded opacity-90 select-none z-10"
  >
    <div v-if="isExtracting && !audioPeaks" class="absolute inset-0 flex items-center justify-center">
      <div class="w-4 h-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin"></div>
    </div>
    
    <div
      v-else-if="audioPeaks"
      class="absolute inset-y-0 h-full flex"
      :style="{
        left: `${-trimOffsetPx}px`,
        width: `${totalWidthPx}px`,
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
  </div>
</template>
