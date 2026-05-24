<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import { useMediaStore } from '~/stores/media.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import type { TimelineClipItem, TimelineDocument } from '~/timeline/types';
import { parseTimelineFromOtio } from '~/timeline/otio-serializer';
import { buildEffectiveAudioClipItems } from '~/utils/audio/track-bus';
import { computeWaveformWindowMetrics, resolveWaveformSourceUs } from '~/utils/audio/waveform';
import { runQueuedPeakExtraction } from '~/utils/audio/waveform-extraction-queue';
import {
  normalizeProjectPath,
  resolveNestedMediaPath,
} from '~/utils/video-editor/worker-clip-utils';

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

const nestedAudioPeaks = ref<Float32Array[] | null>(null);

const audioPeaks = computed<Float32Array[] | null>(() => {
  if (!fileUrl.value) return null;
  if (isNestedTimeline.value) return nestedAudioPeaks.value;
  const meta = mediaStore.mediaMetadata[fileUrl.value];
  return meta?.audioPeaks || null;
});

const isExtracting = ref(false);
const hasDeferredExtraction = ref(false);

let isUnmounted = false;
let extractCallId = 0;

const effectiveSourceDurationUs = computed(() => {
  const explicit = props.item.sourceDurationUs;
  if (explicit && explicit > 0) return explicit;

  if (fileUrl.value) {
    const metaDurationS = mediaStore.mediaMetadata[fileUrl.value]?.duration;
    if (metaDurationS && metaDurationS > 0) {
      return Math.floor(metaDurationS * 1_000_000);
    }
  }

  const rangeEndUs = props.item.sourceRange.startUs + props.item.sourceRange.durationUs;
  if (rangeEndUs > 0) return rangeEndUs;

  return props.item.sourceRange.durationUs || 0;
});

const durationUs = computed(() => effectiveSourceDurationUs.value);

function makeEmptyPeaks(channelCount: number, length: number): Float32Array[] {
  return Array.from({ length: channelCount }, () => new Float32Array(length));
}

function mixPeakValue(target: number, next: number) {
  return Math.max(Math.abs(target), Math.abs(next));
}

async function ensureMediaPeaks(params: {
  path: string;
  maxLength: number;
  shouldCancel?: () => boolean;
}): Promise<Float32Array[] | null> {
  const { path, maxLength, shouldCancel } = params;
  const existing = mediaStore.mediaMetadata[path]?.audioPeaks;
  if (existing && existing.length > 0) return existing;

  const metadata = await mediaStore.getOrFetchMetadataByPath(path);
  if (shouldCancel?.()) return null;

  const cachedAfterMetadataLoad =
    mediaStore.mediaMetadata[path]?.audioPeaks ??
    (metadata as { audioPeaks?: Float32Array[] } | null)?.audioPeaks;
  if (cachedAfterMetadataLoad && cachedAfterMetadataLoad.length > 0) {
    return cachedAfterMetadataLoad;
  }

  return await runQueuedPeakExtraction({
    path,
    shouldCancel,
    task: async () => {
      const cached = mediaStore.mediaMetadata[path]?.audioPeaks;
      if (cached && cached.length > 0) return cached;
      if (shouldCancel?.()) return null;

      const file = await projectStore.getFileByPath(path);
      if (!file || shouldCancel?.()) return null;

      try {
        const peaks = await mediaStore.extractPeaks(file, path, {
          maxLength,
          precision: 10000,
        });
        if (peaks && !shouldCancel?.()) {
          mediaStore.setAudioPeaks(path, peaks);
          return peaks;
        }
        return null;
      } catch (err) {
        console.error('Failed to extract peaks:', err);
        return null;
      }
    },
  });
}

async function buildTimelinePeaks(params: {
  doc: TimelineDocument;
  durationUs: number;
  maxLength: number;
  visiting: Set<string>;
  timelinePath?: string;
  docCache?: Map<string, TimelineDocument>;
  shouldCancel?: () => boolean;
}): Promise<Float32Array[] | null> {
  const { doc, durationUs, maxLength, visiting, timelinePath, docCache, shouldCancel } = params;
  if (durationUs <= 0 || maxLength <= 0) return null;
  if (shouldCancel?.()) return null;

  const effectiveItems = buildEffectiveAudioClipItems({
    audioTracks: doc.tracks.filter((track) => track.kind === 'audio'),
    videoTracks: doc.tracks.filter((track) => track.kind === 'video'),
  });

  let mixedPeaks: Float32Array[] | null = null;

  for (const item of effectiveItems) {
    if (shouldCancel?.()) return null;
    if (item.kind !== 'clip') continue;
    const clip = item as TimelineClipItem;
    const rawPath = clip.source?.path;
    if (!rawPath) continue;
    const path = timelinePath
      ? resolveNestedMediaPath({ nestedTimelinePath: timelinePath, mediaPath: rawPath })
      : rawPath;

    let sourcePeaks: Float32Array[] | null = null;
    const clipSourceDurationUs =
      clip.sourceDurationUs && clip.sourceDurationUs > 0
        ? clip.sourceDurationUs
        : path
          ? (() => {
              const metaDurationS = mediaStore.mediaMetadata[path]?.duration;
              return metaDurationS && metaDurationS > 0 ? Math.floor(metaDurationS * 1_000_000) : 0;
            })()
          : 0;

    // Fallback to clip.sourceRange end is incorrect (that's only the used range, not full source).
    // Use itemSourceDurationUs as last resort so source-relative bucket math stays consistent.
    const sourceDurationUs = Math.max(
      1,
      Math.round(clipSourceDurationUs || clip.sourceRange.durationUs || 0),
    );

    if (clip.clipType === 'timeline') {
      if (visiting.has(path)) continue;

      let nestedDoc = docCache?.get(path) ?? null;
      if (!nestedDoc) {
        const file = await fileManager.vfs.getFile(path);
        if (!file || shouldCancel?.()) continue;
        const text = await file.text();
        if (shouldCancel?.()) return null;
        nestedDoc = parseTimelineFromOtio(text, {
          id: 'nested-waveform',
          name: clip.name,
          format: { fps: 25 },
        });
        docCache?.set(path, nestedDoc);
      }

      visiting.add(path);
      const nestedDurationS = sourceDurationUs / 1_000_000;
      const nestedMaxLength = Math.max(8000, Math.ceil(nestedDurationS * 200));

      sourcePeaks = await buildTimelinePeaks({
        doc: nestedDoc,
        durationUs: sourceDurationUs,
        maxLength: nestedMaxLength,
        visiting,
        timelinePath: path,
        docCache,
        shouldCancel,
      });
      visiting.delete(path);
    } else {
      if (shouldCancel?.()) return null;
      sourcePeaks = await ensureMediaPeaks({ path, maxLength, shouldCancel });
      if (shouldCancel?.()) return null;
    }

    if (!sourcePeaks || sourcePeaks.length === 0) continue;

    const channelCount = sourcePeaks.length;
    if (!mixedPeaks) {
      mixedPeaks = makeEmptyPeaks(channelCount, maxLength);
    } else if (mixedPeaks.length < channelCount) {
      for (let channelIndex = mixedPeaks.length; channelIndex < channelCount; channelIndex++) {
        mixedPeaks.push(new Float32Array(maxLength));
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
      const sourceUs = resolveWaveformSourceUs({
        absoluteUs,
        clipStartUs: itemStartUs,
        clipDurationUs: itemDurationUs,
        sourceStartUs: itemSourceStartUs,
        sourceRangeDurationUs: itemSourceDurationUs,
        speed: clip.speed,
      });
      if (sourceUs === null) continue;

      for (let channelIndex = 0; channelIndex < mixedPeaks.length; channelIndex++) {
        const sourceChannel = sourcePeaks[channelIndex] ?? sourcePeaks[0];
        if (!sourceChannel || sourceChannel.length === 0) continue;
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
  if (timelineStore.isPlaying) {
    hasDeferredExtraction.value = true;
    return;
  }

  hasDeferredExtraction.value = false;
  const callId = ++extractCallId;
  const urlAtStart = fileUrl.value;
  const shouldCancel = () =>
    isUnmounted ||
    timelineStore.isPlaying ||
    callId !== extractCallId ||
    fileUrl.value !== urlAtStart;
  try {
    isExtracting.value = true;

    if (isNestedTimeline.value) {
      const normalizedTimelinePath = normalizeProjectPath(fileUrl.value);
      const file = await fileManager.vfs.getFile(normalizedTimelinePath);
      if (!file) return;

      if (shouldCancel()) {
        return;
      }

      const text = await file.text();
      if (shouldCancel()) {
        return;
      }
      const nestedDoc = parseTimelineFromOtio(text, {
        id: 'nested-waveform-root',
        name: props.item.name,
        format: { fps: 25 },
      });

      const durationS = effectiveSourceDurationUs.value / 1_000_000;
      const samplesPerSecond = 200;
      const maxLength = Math.max(8000, Math.ceil(durationS * samplesPerSecond));

      const peaks = await buildTimelinePeaks({
        doc: nestedDoc,
        durationUs: Math.max(1, Math.round(effectiveSourceDurationUs.value)),
        maxLength,
        visiting: new Set<string>([normalizedTimelinePath]),
        timelinePath: normalizedTimelinePath,
        docCache: new Map<string, TimelineDocument>([[normalizedTimelinePath, nestedDoc]]),
        shouldCancel,
      });

      if (shouldCancel()) {
        return;
      }

      nestedAudioPeaks.value = peaks;
      void redrawMountedChunks();
      return;
    }

    // Resolution budget: ~200 samples per second is more than enough — even at
    // max zoom (~1280 px/s) there is no benefit from a denser array, and a denser
    // one bloats OPFS JSON and JSON.stringify cost for long sources.
    const durationS = effectiveSourceDurationUs.value / 1_000_000;
    const samplesPerSecond = 200;
    const maxLength = Math.max(8000, Math.ceil(durationS * samplesPerSecond));

    const peaks = await ensureMediaPeaks({
      path: fileUrl.value,
      maxLength,
      shouldCancel,
    });

    if (shouldCancel()) {
      if (timelineStore.isPlaying) {
        hasDeferredExtraction.value = true;
      }
      return;
    }

    if (peaks) {
      void redrawMountedChunks();
    }
  } catch (err) {
    console.error('Failed to extract audio peaks:', err);
  } finally {
    isExtracting.value = false;
  }
};

function requestPeaksExtraction() {
  if (audioPeaks.value) return;
  if (timelineStore.isPlaying) {
    hasDeferredExtraction.value = true;
    return;
  }

  void extractPeaks();
}

watch(
  fileUrl,
  () => {
    requestPeaksExtraction();
  },
  { immediate: true },
);

watch(
  () => timelineStore.isPlaying,
  (isPlaying) => {
    if (isPlaying) {
      if (isExtracting.value) {
        hasDeferredExtraction.value = true;
        extractCallId += 1;
      }
      return;
    }

    if (hasDeferredExtraction.value && !audioPeaks.value) {
      requestPeaksExtraction();
    }
  },
);

onMounted(() => {
  isUnmounted = false;
  requestPeaksExtraction();
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

const isReversed = computed(() => (props.item.speed ?? 1) < 0);

const waveformMetrics = computed(() =>
  computeWaveformWindowMetrics({
    sourceStartUs: props.item.sourceRange.startUs,
    sourceDurationUs: durationUs.value,
    timelineDurationUs: props.item.timelineRange.durationUs,
    speed: props.item.speed,
    zoom: timelineStore.timelineZoom,
  }),
);

// Chunking logic (similar to video thumbnails but for waveform rendering)
const CHUNK_WIDTH_PX = 1000; // Fixed chunk width in pixels for canvas

const totalWidthPx = computed(() => {
  return waveformMetrics.value.totalWidthPx;
});

const waveformLeftPx = computed(() => waveformMetrics.value.leftPx);

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

  // Calculate which portion of the peaks array falls into this chunk.
  // We include one extra peak at the end (if available) so that the line
  // connects smoothly to the start of the next chunk instead of dropping to zero.
  const startRatio = chunk.startPx / totalW;
  const endRatio = (chunk.startPx + chunk.widthPx) / totalW;

  const startIndex = Math.floor(startRatio * peaksCount);
  const endIndex = Math.min(peaksCount, Math.ceil(endRatio * peaksCount) + 1);
  const chunkLength = endIndex - startIndex;

  if (chunkLength <= 0) return;

  const halfH = targetHeight / 2;
  const step = chunkLength > 1 ? targetWidth / (chunkLength - 1) : targetWidth;

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
      const y = targetHeight - Math.min(1, peak) * targetHeight;
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
      const y = halfH - Math.min(1, peak) * halfH;
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
      const y = halfH + Math.min(1, peak) * halfH;
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

// External peaks updates (e.g. cache refresh, late extraction completion) must
// trigger a redraw — otherwise the canvas stays empty until the user pans/zooms.
watch(audioPeaks, () => {
  if (audioPeaks.value) {
    hasDeferredExtraction.value = false;
  }
  void redrawMountedChunks();
});

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
        left: `${waveformLeftPx}px`,
        width: `${totalWidthPx}px`,
        transform: isReversed ? 'scaleX(-1)' : undefined,
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
