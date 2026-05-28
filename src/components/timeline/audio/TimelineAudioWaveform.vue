<script setup lang="ts">
import { createDevLogger } from '~/utils/dev-logger';

import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import { useMediaStore } from '~/stores/media.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import type { TimelineClipItem, TimelineDocument } from '~/timeline/types';
import { parseTimelineFromOtio } from '~/timeline/otio-serializer';
import { buildEffectiveAudioClipItems } from '~/utils/audio/track-bus';
import {
  computeWaveformPeakBins,
  computeWaveformRenderBudget,
  computeWaveformWindowMetrics,
  resolveWaveformSourceUs,
} from '~/utils/audio/waveform';
import { runQueuedPeakExtraction } from '~/utils/audio/waveform-extraction-queue';
import { timeUsToPx } from '~/utils/timeline/geometry';
import {
  normalizeProjectPath,
  resolveNestedMediaPath,
} from '~/utils/video-editor/worker-clip-utils';
const log = createDevLogger('TimelineAudioWaveform');

const props = defineProps<{
  item: TimelineClipItem;
  scrollLeft?: number;
  viewportWidth?: number;
}>();

const timelineStore = useTimelineStore();
const projectStore = useProjectStore();
const mediaStore = useMediaStore();
const fileManager = useFileManager();

const rootEl = ref<HTMLElement | null>(null);
const chunkEls = new Map<number, HTMLElement>();
const chunkCanvases = new Map<number, HTMLCanvasElement>();
const chunkDrawSignatures = new Map<number, string>();
const waveformPeakIds = new WeakMap<readonly Float32Array[], number>();

let resizeObserver: ResizeObserver | null = null;
let redrawFrameId = 0;
let nextWaveformPeakId = 1;

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
        log.error('Failed to extract peaks:', err);
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
    log.error('Failed to extract audio peaks:', err);
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
  if (redrawFrameId) {
    window.cancelAnimationFrame(redrawFrameId);
    redrawFrameId = 0;
  }
  resizeObserver?.disconnect();
  resizeObserver = null;
  chunkEls.clear();
  chunkCanvases.clear();
  chunkDrawSignatures.clear();
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

interface WaveformChunk {
  chunkIndex: number;
  widthPx: number;
  startPx: number;
}

// Chunking logic (similar to video thumbnails but for waveform rendering)
const CHUNK_WIDTH_PX = 1000; // Fixed chunk width in pixels for canvas
const CHUNK_OVERSCAN_PX = CHUNK_WIDTH_PX * 2;
const MAX_WAVEFORM_DRAW_POINTS_PER_CHUNK = 2048;

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

const chunkCount = computed(() => {
  const totalW = totalWidthPx.value;
  if (totalW <= 0) return 0;
  return Math.ceil(totalW / CHUNK_WIDTH_PX);
});

const clipStartPx = computed(() => {
  return timeUsToPx(props.item.timelineRange.startUs, timelineStore.timelineZoom);
});

function buildWaveformChunk(chunkIndex: number): WaveformChunk {
  const totalW = totalWidthPx.value;
  const isLast = chunkIndex === chunkCount.value - 1;
  const startPx = chunkIndex * CHUNK_WIDTH_PX;
  return {
    chunkIndex,
    widthPx: isLast ? totalW - startPx : CHUNK_WIDTH_PX,
    startPx,
  };
}

const visibleWaveformChunks = computed<WaveformChunk[]>(() => {
  const count = chunkCount.value;
  const totalW = totalWidthPx.value;
  if (count <= 0 || totalW <= 0) return [];

  const viewportWidth = props.viewportWidth ?? timelineStore.timelineViewportWidth;
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    return [buildWaveformChunk(0)];
  }

  const scrollLeft = props.scrollLeft ?? timelineStore.timelineScrollLeftPx;
  const stripStartInTimeline = clipStartPx.value + waveformLeftPx.value;
  const visibleLeft = scrollLeft - stripStartInTimeline;
  const visibleRight = visibleLeft + viewportWidth;
  const overscanPx = Math.max(CHUNK_OVERSCAN_PX, viewportWidth * 0.5);

  const firstIndex = Math.max(0, Math.floor((visibleLeft - overscanPx) / CHUNK_WIDTH_PX));
  const lastIndex = Math.min(count - 1, Math.ceil((visibleRight + overscanPx) / CHUNK_WIDTH_PX));

  if (lastIndex < firstIndex) return [];

  return Array.from({ length: lastIndex - firstIndex + 1 }, (_, index) =>
    buildWaveformChunk(firstIndex + index),
  );
});

const visibleWaveformChunkKey = computed(() => {
  const chunks = visibleWaveformChunks.value;
  if (chunks.length === 0) return 'empty';
  const firstChunk = chunks[0]!;
  const lastChunk = chunks[chunks.length - 1]!;
  return `${chunks.length}:${firstChunk.chunkIndex}:${lastChunk.chunkIndex}:${firstChunk.widthPx}:${lastChunk.widthPx}`;
});

function getWaveformPeakId(channels: readonly Float32Array[]) {
  const existing = waveformPeakIds.get(channels);
  if (existing) return existing;
  const id = nextWaveformPeakId++;
  waveformPeakIds.set(channels, id);
  return id;
}

function pruneUnmountedChunkRefs() {
  const visibleIndexes = new Set(visibleWaveformChunks.value.map((chunk) => chunk.chunkIndex));
  for (const index of chunkEls.keys()) {
    if (!visibleIndexes.has(index)) chunkEls.delete(index);
  }
  for (const index of chunkCanvases.keys()) {
    if (!visibleIndexes.has(index)) chunkCanvases.delete(index);
  }
}

function setChunkEl(el: unknown, chunkIndex: number) {
  if (el instanceof HTMLElement) {
    chunkEls.set(chunkIndex, el);
  } else {
    chunkEls.delete(chunkIndex);
  }
}

function setChunkCanvas(el: unknown, chunkIndex: number) {
  if (el instanceof HTMLCanvasElement) {
    chunkCanvases.set(chunkIndex, el);
  } else {
    chunkCanvases.delete(chunkIndex);
    chunkDrawSignatures.delete(chunkIndex);
  }
}

function drawChunk(chunkIndex: number) {
  const chunk = visibleWaveformChunks.value.find((c) => c.chunkIndex === chunkIndex);
  if (!chunk) return;
  const canvas = chunkCanvases.get(chunkIndex);
  const root = rootEl.value;
  if (!canvas || !root) return;
  if (!audioPeaks.value || audioPeaks.value.length === 0) return;

  const cssHeight = Math.max(1, canvas.parentElement?.clientHeight || root.clientHeight);
  const cssWidth = Math.max(1, Math.round(chunk.widthPx));
  const renderBudget = computeWaveformRenderBudget({
    cssWidth,
    devicePixelRatio: window.devicePixelRatio || 1,
    zoom: timelineStore.timelineZoom,
    maxPointsPerChunk: MAX_WAVEFORM_DRAW_POINTS_PER_CHUNK,
  });

  const targetWidth = Math.max(1, Math.round(cssWidth * renderBudget.effectiveDevicePixelRatio));
  const targetHeight = Math.max(1, Math.round(cssHeight * renderBudget.effectiveDevicePixelRatio));

  if (canvas.width !== targetWidth) canvas.width = targetWidth;
  if (canvas.height !== targetHeight) canvas.height = targetHeight;
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const channels = audioPeaks.value;
  if (!channels || channels.length === 0) return;

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
  const mode = props.item.audioWaveformMode || 'half';
  const muted = isMuted.value;
  const peakId = getWaveformPeakId(channels);
  const drawSignature = [
    peakId,
    peaksCount,
    chunk.startPx,
    chunk.widthPx,
    totalW,
    startIndex,
    endIndex,
    renderBudget.outputBins,
    targetWidth,
    targetHeight,
    props.item.audioGain ?? 1,
    mode,
    muted ? 1 : 0,
  ].join(':');

  if (chunkDrawSignatures.get(chunkIndex) === drawSignature) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const peakBins = computeWaveformPeakBins({
    channels,
    startIndex,
    endIndex,
    outputBins: renderBudget.outputBins,
    gain: props.item.audioGain ?? 1,
  });

  if (peakBins.length <= 0) return;

  const halfH = targetHeight / 2;
  const step = peakBins.length > 1 ? targetWidth / (peakBins.length - 1) : targetWidth;

  if (muted) {
    ctx.fillStyle = '#ffffff66';
  } else {
    ctx.fillStyle = '#ffffff';
  }

  ctx.beginPath();

  if (mode === 'half') {
    ctx.moveTo(0, targetHeight);
    for (let i = 0; i < peakBins.length; i++) {
      const x = i * step;
      const y = targetHeight - Math.min(1, peakBins[i] ?? 0) * targetHeight;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(targetWidth, targetHeight);
  } else {
    // Draw top half
    ctx.moveTo(0, halfH);
    for (let i = 0; i < peakBins.length; i++) {
      const x = i * step;
      const y = halfH - Math.min(1, peakBins[i] ?? 0) * halfH;
      ctx.lineTo(x, y);
    }

    // Draw bottom half (mirrored)
    for (let i = peakBins.length - 1; i >= 0; i--) {
      const x = i * step;
      const y = halfH + Math.min(1, peakBins[i] ?? 0) * halfH;
      ctx.lineTo(x, y);
    }
  }

  ctx.closePath();
  ctx.fill();
  chunkDrawSignatures.set(chunkIndex, drawSignature);
}

async function redrawVisibleChunks() {
  await nextTick();
  for (const chunk of visibleWaveformChunks.value) {
    const canvas = chunkCanvases.get(chunk.chunkIndex);
    if (!canvas) continue;
    drawChunk(chunk.chunkIndex);
  }
}

const redrawMountedChunks = redrawVisibleChunks;

function requestRedrawMountedChunks() {
  if (redrawFrameId) return;
  redrawFrameId = window.requestAnimationFrame(() => {
    redrawFrameId = 0;
    void redrawMountedChunks();
  });
}

function invalidateDrawCache() {
  chunkDrawSignatures.clear();
}

watch(
  () => [props.item.audioWaveformMode, props.item.audioGain, isMuted.value],
  () => {
    invalidateDrawCache();
    requestRedrawMountedChunks();
  },
);

watch(
  () => [
    totalWidthPx.value,
    waveformLeftPx.value,
    timelineStore.timelineZoom,
    props.item.timelineRange.startUs,
    props.item.timelineRange.durationUs,
    props.item.sourceRange.startUs,
    props.item.sourceRange.durationUs,
    props.item.speed,
  ],
  () => {
    invalidateDrawCache();
    requestRedrawMountedChunks();
  },
);

// External peaks updates (e.g. cache refresh, late extraction completion) must
// trigger a redraw — otherwise the canvas stays empty until the user pans/zooms.
watch(audioPeaks, () => {
  if (audioPeaks.value) {
    hasDeferredExtraction.value = false;
  }
  invalidateDrawCache();
  requestRedrawMountedChunks();
});

watch(
  visibleWaveformChunkKey,
  () => {
    void nextTick().then(() => {
      pruneUnmountedChunkRefs();
      requestRedrawMountedChunks();
    });
  },
  { immediate: true, flush: 'post' },
);

onMounted(() => {
  resizeObserver = new ResizeObserver(() => {
    invalidateDrawCache();
    requestRedrawMountedChunks();
  });

  if (rootEl.value) {
    resizeObserver.observe(rootEl.value);
  }
});
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
        v-for="chunk in visibleWaveformChunks"
        :key="chunk.chunkIndex"
        :ref="(el) => setChunkEl(el, chunk.chunkIndex)"
        class="absolute top-0 h-full overflow-hidden"
        :data-chunk-index="chunk.chunkIndex"
        :style="{
          left: `${chunk.startPx}px`,
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
