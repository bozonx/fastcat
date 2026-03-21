<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import { useMediaStore } from '~/stores/media.store';
import { useFileManager } from '~/composables/fileManager/useFileManager';
import { timeUsToPx } from '~/utils/timeline/geometry';
import { AudioEngine } from '~/utils/video-editor/AudioEngine';
import type { TimelineClipItem, TimelineDocument, TimelineTrackItem } from '~/timeline/types';
import { parseTimelineFromOtio } from '~/timeline/otioSerializer';
import { buildEffectiveAudioClipItems } from '~/utils/audio/track-bus';

const props = defineProps<{
  item: TimelineClipItem;
}>();

const timelineStore = useTimelineStore();
const projectStore = useProjectStore();
const mediaStore = useMediaStore();
const fileManager = useFileManager();

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

const isNestedTimeline = computed(() => props.item.clipType === 'timeline');

const nestedAudioPeaks = ref<number[][] | null>(null);

const audioPeaks = computed(() => {
  if (!fileUrl.value) return null;
  if (isNestedTimeline.value) return nestedAudioPeaks.value;
  const meta = mediaStore.mediaMetadata[fileUrl.value];
  return meta?.audioPeaks || null;
});

const isExtracting = ref(false);

let isUnmounted = false;
let extractCallId = 0;

function makeEmptyPeaks(channelCount: number, length: number) {
  return Array.from({ length: channelCount }, () => Array.from({ length }, () => 0));
}

function mixPeakValue(target: number, next: number) {
  return Math.max(Math.abs(target), Math.abs(next));
}

async function ensureMediaPeaks(path: string, maxLength: number): Promise<number[][] | null> {
  const existing = mediaStore.mediaMetadata[path]?.audioPeaks;
  if (existing && existing.length > 0) return existing;

  const fileHandle = await projectStore.getFileHandleByPath(path);
  if (!fileHandle) return null;

  const engine = new AudioEngine();
  try {
    const peaks = await engine.extractPeaks(fileHandle, path, {
      maxLength,
      precision: 10000,
    });
    if (peaks) {
      mediaStore.setAudioPeaks(path, peaks);
      return peaks;
    }
    return null;
  } finally {
    try {
      engine.destroy();
    } catch {
      // ignore
    }
  }
}

async function buildTimelinePeaks(params: {
  doc: TimelineDocument;
  durationUs: number;
  maxLength: number;
  visiting: Set<string>;
}): Promise<number[][] | null> {
  const { doc, durationUs, maxLength, visiting } = params;
  if (durationUs <= 0 || maxLength <= 0) return null;

  const effectiveItems = buildEffectiveAudioClipItems({
    audioTracks: doc.tracks.filter((track) => track.kind === 'audio'),
    videoTracks: doc.tracks.filter((track) => track.kind === 'video'),
  });

  let mixedPeaks: number[][] | null = null;

  for (const item of effectiveItems) {
    if (item.kind !== 'clip') continue;
    const clip = item as TimelineClipItem;
    const path = clip.source?.path;
    if (!path) continue;

    let sourcePeaks: number[][] | null = null;
    const sourceDurationUs = Math.max(
      1,
      Math.round(clip.sourceDurationUs || clip.sourceRange.durationUs || 0),
    );

    if (clip.clipType === 'timeline') {
      if (visiting.has(path)) continue;

      const file = await fileManager.vfs.getFile(path);
      if (!file) continue;
      const text = await file.text();
      const nestedDoc = parseTimelineFromOtio(text, {
        id: 'nested-waveform',
        name: clip.name,
        fps: 25,
      });

      visiting.add(path);
      sourcePeaks = await buildTimelinePeaks({
        doc: nestedDoc,
        durationUs: sourceDurationUs,
        maxLength,
        visiting,
      });
      visiting.delete(path);
    } else {
      sourcePeaks = await ensureMediaPeaks(path, maxLength);
    }

    if (!sourcePeaks || sourcePeaks.length === 0) continue;

    const channelCount = sourcePeaks.length;
    if (!mixedPeaks) {
      mixedPeaks = makeEmptyPeaks(channelCount, maxLength);
    } else if (mixedPeaks.length < channelCount) {
      for (let channelIndex = mixedPeaks.length; channelIndex < channelCount; channelIndex++) {
        mixedPeaks.push(Array.from({ length: maxLength }, () => 0));
      }
    }

    const itemStartUs = Math.max(0, Math.round(clip.timelineRange.startUs));
    const itemDurationUs = Math.max(0, Math.round(clip.timelineRange.durationUs));
    const itemSourceStartUs = Math.max(0, Math.round(clip.sourceRange.startUs));
    const itemSourceDurationUs = Math.max(1, Math.round(clip.sourceRange.durationUs));
    const gain = Math.max(0, Math.min(10, Number(clip.audioGain ?? 1)));

    const startIndex = Math.max(0, Math.floor((itemStartUs / durationUs) * maxLength));
    const endIndex = Math.min(
      maxLength,
      Math.ceil(((itemStartUs + itemDurationUs) / durationUs) * maxLength),
    );

    for (let sampleIndex = startIndex; sampleIndex < endIndex; sampleIndex++) {
      const parentRatio = sampleIndex / maxLength;
      const absoluteUs = parentRatio * durationUs;
      const localUs = absoluteUs - itemStartUs;
      if (localUs < 0 || localUs > itemDurationUs) continue;

      const sourceUs =
        itemSourceStartUs + (localUs / Math.max(1, itemDurationUs)) * itemSourceDurationUs;

      for (let channelIndex = 0; channelIndex < mixedPeaks.length; channelIndex++) {
        const sourceChannel = sourcePeaks[channelIndex] ?? sourcePeaks[0] ?? [];
        if (sourceChannel.length === 0) continue;
        const sourceIndex = Math.min(
          sourceChannel.length - 1,
          Math.max(0, Math.floor((sourceUs / sourceDurationUs) * sourceChannel.length)),
        );
        const current = mixedPeaks[channelIndex]?.[sampleIndex] ?? 0;
        const next = (sourceChannel[sourceIndex] ?? 0) * gain;
        mixedPeaks[channelIndex]![sampleIndex] = mixPeakValue(current, next);
      }
    }
  }

  return mixedPeaks;
}

const extractPeaks = async () => {
  if (!fileUrl.value || !projectStore.currentProjectId) return;
  if (audioPeaks.value || isExtracting.value) return;

  const callId = ++extractCallId;
  const urlAtStart = fileUrl.value;
  let engine: AudioEngine | null = null;

  try {
    isExtracting.value = true;

    if (isNestedTimeline.value) {
      const file = await fileManager.vfs.getFile(fileUrl.value);
      if (!file) return;

      if (isUnmounted || callId !== extractCallId || fileUrl.value !== urlAtStart) {
        return;
      }

      const text = await file.text();
      const nestedDoc = parseTimelineFromOtio(text, {
        id: 'nested-waveform-root',
        name: props.item.name,
        fps: 25,
      });

      const durationS = (props.item.sourceDurationUs || 0) / 1_000_000;
      const samplesPerSecond = 1000;
      const maxLength = Math.max(8000, Math.ceil(durationS * samplesPerSecond));

      const peaks = await buildTimelinePeaks({
        doc: nestedDoc,
        durationUs: Math.max(
          1,
          Math.round(props.item.sourceDurationUs || props.item.sourceRange.durationUs),
        ),
        maxLength,
        visiting: new Set<string>([fileUrl.value]),
      });

      if (isUnmounted || callId !== extractCallId || fileUrl.value !== urlAtStart) {
        return;
      }

      nestedAudioPeaks.value = peaks;
      void redrawMountedChunks();
      return;
    }

    const fileHandle = await projectStore.getFileHandleByPath(fileUrl.value);
    if (!fileHandle) return;

    if (isUnmounted || callId !== extractCallId || fileUrl.value !== urlAtStart) {
      return;
    }

    engine = new AudioEngine();

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

    if (isUnmounted || callId !== extractCallId || fileUrl.value !== urlAtStart) {
      return;
    }

    if (peaks) {
      mediaStore.setAudioPeaks(fileUrl.value, peaks);
      void redrawMountedChunks();
    }
  } catch (err) {
    console.error('Failed to extract audio peaks:', err);
  } finally {
    try {
      engine?.destroy();
    } catch {
      // ignore
    }
    isExtracting.value = false;
  }
};

watch(
  fileUrl,
  () => {
    if (!audioPeaks.value) {
      void extractPeaks();
    }
  },
  { immediate: true },
);

onMounted(() => {
  isUnmounted = false;
  void extractPeaks();
});

onBeforeUnmount(() => {
  isUnmounted = true;
  extractCallId += 1;
  chunkObserver?.disconnect();
  chunkObserver = null;
  resizeObserver?.disconnect();
  resizeObserver = null;
  visibleChunks.value.clear();
});

const speed = computed(() => {
  const s = props.item.speed || 1;
  const abs = Math.abs(s);
  // Prevent division by zero and extreme values
  return Math.max(0.001, Math.min(100, abs));
});

const trimOffsetPx = computed(() => {
  return timeUsToPx(props.item.sourceRange.startUs / speed.value, timelineStore.timelineZoom);
});

const durationUs = computed(
  () => props.item.sourceDurationUs || props.item.sourceRange.durationUs || 0,
);

// Chunking logic (similar to video thumbnails but for waveform rendering)
const CHUNK_WIDTH_PX = 1000; // Fixed chunk width in pixels for canvas

const totalWidthPx = computed(() => {
  return timeUsToPx(durationUs.value / speed.value, timelineStore.timelineZoom);
});

const track = computed(() => {
  return timelineStore.timelineDoc?.tracks.find((t) => t.id === props.item.trackId);
});

const isMuted = computed(() => {
  return (
    props.item.audioMuted ||
    track.value?.audioMuted ||
    timelineStore.audioMuted ||
    props.item.disabled ||
    track.value?.videoHidden
  );
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

  const channels = audioPeaks.value;
  if (!channels || channels.length === 0) return;

  const numChannels = channels.length;
  const peaksCount = channels[0]?.length || 0;
  if (peaksCount === 0) return;

  const totalW = totalWidthPx.value;

  // Calculate which portion of the peaks array falls into this chunk
  const startRatio = chunk.startPx / totalW;
  const endRatio = (chunk.startPx + chunk.widthPx) / totalW;

  const startIndex = Math.floor(startRatio * peaksCount);
  const endIndex = Math.min(peaksCount, Math.ceil(endRatio * peaksCount));
  const chunkLength = endIndex - startIndex;

  if (chunkLength <= 0) return;

  const halfH = targetHeight / 2;
  const step = targetWidth / chunkLength;

  const mode = props.item.audioWaveformMode || 'half';
  const gain = props.item.audioGain ?? 1;
  const muted = isMuted.value;

  if (muted) {
    ctx.fillStyle = '#ffffff66';
  } else {
    ctx.fillStyle = '#ffffff';
  }

  ctx.beginPath();

  if (mode === 'half') {
    ctx.moveTo(0, targetHeight);
    for (let i = 0; i < chunkLength; i++) {
      const x = i * step;
      let peak = 0;
      for (let ch = 0; ch < numChannels; ch++) {
        const p = Math.abs(channels[ch]?.[startIndex + i] || 0);
        if (p > peak) peak = p;
      }
      peak *= gain;
      const y = targetHeight - Math.min(1.1, peak) * targetHeight;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(targetWidth, targetHeight);
  } else {
    // Draw top half
    ctx.moveTo(0, halfH);
    for (let i = 0; i < chunkLength; i++) {
      const x = i * step;
      let peak = 0;
      for (let ch = 0; ch < numChannels; ch++) {
        const p = Math.abs(channels[ch]?.[startIndex + i] || 0);
        if (p > peak) peak = p;
      }
      peak *= gain;
      const y = halfH - Math.min(1.1, peak) * halfH;
      ctx.lineTo(x, y);
    }

    // Draw bottom half (mirrored)
    for (let i = chunkLength - 1; i >= 0; i--) {
      const x = i * step;
      let peak = 0;
      for (let ch = 0; ch < numChannels; ch++) {
        const p = Math.abs(channels[ch]?.[startIndex + i] || 0);
        if (p > peak) peak = p;
      }
      peak *= gain;
      const y = halfH + Math.min(1.1, peak) * halfH;
      ctx.lineTo(x, y);
    }
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
  () => [props.item.audioWaveformMode, props.item.audioGain, isMuted.value],
  () => {
    void redrawMountedChunks();
  },
);

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
    class="absolute inset-0 overflow-hidden pointer-events-none rounded select-none z-10"
  >
    <!-- Background Gradient Shading to make waveform more visible -->
    <div
      v-if="audioPeaks"
      class="absolute inset-0 bg-linear-to-b from-black/0 via-black/30 to-black/0"
    />

    <div
      v-if="isExtracting && !audioPeaks"
      class="absolute inset-0 flex items-center justify-center"
    >
      <div
        class="w-4 h-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin"
      ></div>
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
