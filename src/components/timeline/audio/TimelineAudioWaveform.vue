<script setup lang="ts">
import { createDevLogger } from '~/utils/dev-logger';

import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import { useMediaStore } from '~/stores/media.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import type { TimelineClipItem, TimelineDocument } from '~/timeline/types';
import { parseTimelineFromOtio } from '~/timeline/otio-serializer';
import {
  computeWaveformRenderBudget,
  computeWaveformWindowMetrics,
  computeWaveformPeakLength,
} from '~/utils/audio/waveform';
import { computeWaveformPeakBinsFromMips } from '~/utils/audio/waveform-mips';
import { buildTimelinePeaks } from '~/utils/audio/timeline-waveform';
import {
  scheduleWaveformRedraw,
  cancelWaveformRedraw,
} from '~/utils/audio/waveform-render-scheduler';
import { runQueuedPeakExtraction } from '~/utils/audio/waveform-extraction-queue';
import { timeUsToPx } from '~/utils/timeline/geometry';
import { isTauriRuntime } from '~/utils/runtime';
import { normalizeProjectPath } from '~/utils/video-editor/worker-clip-utils';
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
const canvasEl = ref<HTMLCanvasElement | null>(null);
const waveformPeakIds = new WeakMap<readonly Float32Array[], number>();

let resizeObserver: ResizeObserver | null = null;
let nextWaveformPeakId = 1;
let lastDrawSignature = '';
let zoomSettleTimer = 0;

// A stable per-instance key so the shared scheduler can coalesce/cancel this
// clip's redraws independently of every other clip.
const schedulerKey = `waveform:${Math.random().toString(36).slice(2)}`;

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
  const meta = mediaStore.getCachedMetadata(fileUrl.value);
  return meta?.audioPeaks || null;
});

const isExtracting = ref(false);
const hasDeferredExtraction = ref(false);

let isUnmounted = false;
let extractCallId = 0;

const effectiveSourceDurationUs = computed(() => {
  // Prefer the real file duration from the metadata cache (ffprobe / symphonia) because
  // props.item.sourceDurationUs may equal only the trimmed source range duration and
  // therefore produce a totalWidthPx that is too small, cutting the waveform short.
  if (fileUrl.value && !isNestedTimeline.value) {
    const meta = mediaStore.getCachedMetadata(fileUrl.value);
    const metaDurationS = meta?.duration;
    if (metaDurationS && metaDurationS > 0) {
      return Math.floor(metaDurationS * 1_000_000);
    }
  }

  const explicit = props.item.sourceDurationUs;
  if (explicit && explicit > 0) return explicit;

  const rangeEndUs = props.item.sourceRange.startUs + props.item.sourceRange.durationUs;
  if (rangeEndUs > 0) return rangeEndUs;

  return props.item.sourceRange.durationUs || 0;
});

const durationUs = computed(() => effectiveSourceDurationUs.value);

function waveformMaxLength(durationS: number): number {
  return computeWaveformPeakLength(durationS);
}

function hasSufficientPeaks(peaks: Float32Array[] | null | undefined, maxLength: number): boolean {
  return Boolean(peaks?.some((channel) => channel.length >= maxLength));
}

async function ensureMediaPeaks(params: {
  path: string;
  maxLength: number;
  durationS?: number;
  shouldCancel?: () => boolean;
}): Promise<Float32Array[] | null> {
  const { path, maxLength, durationS, shouldCancel } = params;
  const existingMeta = mediaStore.getCachedMetadata(path);
  const existing = existingMeta?.audioPeaks;
  if (hasSufficientPeaks(existing, maxLength)) return existing || null;

  const metadata = await mediaStore.getOrFetchMetadataByPath(path);
  if (shouldCancel?.()) return null;
  if (!metadata) {
    log.error('Failed to load metadata before waveform extraction:', path);
  }

  const cachedAfterMetadataLoad =
    mediaStore.getCachedMetadata(path)?.audioPeaks ??
    (metadata as { audioPeaks?: Float32Array[] } | null)?.audioPeaks;
  if (hasSufficientPeaks(cachedAfterMetadataLoad, maxLength)) {
    return cachedAfterMetadataLoad || null;
  }

  return await runQueuedPeakExtraction({
    path,
    cacheKey: `${path}:${maxLength}:${durationS ?? 0}`,
    shouldCancel,
    task: async () => {
      const cached = mediaStore.getCachedMetadata(path)?.audioPeaks;
      if (hasSufficientPeaks(cached, maxLength)) return cached || null;
      if (shouldCancel?.()) return null;

      const file = await fileManager.vfs.getFile(path);
      if (shouldCancel?.()) return null;
      if (!file) {
        log.error('Failed to load source file for waveform extraction:', path);
        return null;
      }

      try {
        const options = {
          maxLength,
          precision: 10000,
          ...(durationS ? { durationS } : {}),
        };
        const peaks = await mediaStore.extractPeaks(file, path, options);
        if (peaks?.some((channel) => channel.length > 0) && !shouldCancel?.()) {
          mediaStore.setAudioPeaks(path, peaks);
          return peaks;
        }
        if (!shouldCancel?.()) {
          log.error('Waveform extraction returned no peaks:', path);
        }
        return null;
      } catch (err) {
        log.error('Failed to extract peaks:', err);
        return null;
      }
    },
  });
}

const extractPeaks = async () => {
  if (!fileUrl.value || !projectStore.currentProjectId) return;
  const maxLength = waveformMaxLength(effectiveSourceDurationUs.value / 1_000_000);
  if (hasSufficientPeaks(audioPeaks.value, maxLength)) return;
  if (isExtracting.value) {
    hasDeferredExtraction.value = true;
    return;
  }
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
      if (!file) {
        log.error(
          'Failed to load nested timeline for waveform extraction:',
          normalizedTimelinePath,
        );
        return;
      }

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

      const peaks = await buildTimelinePeaks({
        doc: nestedDoc,
        durationUs: Math.max(1, Math.round(effectiveSourceDurationUs.value)),
        maxLength,
        visiting: new Set<string>([normalizedTimelinePath]),
        timelinePath: normalizedTimelinePath,
        docCache: new Map<string, TimelineDocument>([[normalizedTimelinePath, nestedDoc]]),
        shouldCancel,
        getMediaDurationUs: (path) => {
          const meta = mediaStore.getCachedMetadata(path);
          const metaDurationS = meta?.duration;
          return metaDurationS && metaDurationS > 0 ? Math.floor(metaDurationS * 1_000_000) : 0;
        },
        loadTimelineDocument: async (path, clip) => {
          const file = await fileManager.vfs.getFile(path);
          if (!file || shouldCancel()) return null;
          const text = await file.text();
          if (shouldCancel()) return null;
          return parseTimelineFromOtio(text, {
            id: 'nested-waveform',
            name: clip.name,
            format: { fps: 25 },
          });
        },
        ensureMediaPeaks,
      });

      if (shouldCancel()) {
        return;
      }

      nestedAudioPeaks.value = peaks;
      if (!peaks?.some((channel) => channel.length > 0)) {
        log.error('Nested timeline waveform extraction returned no peaks:', normalizedTimelinePath);
      }
      requestDraw();
      return;
    }

    const peaks = await ensureMediaPeaks({
      path: fileUrl.value,
      maxLength,
      durationS: effectiveSourceDurationUs.value / 1_000_000,
      shouldCancel,
    });

    if (shouldCancel()) {
      if (timelineStore.isPlaying) {
        hasDeferredExtraction.value = true;
      }
      return;
    }

    if (peaks?.some((channel) => channel.length > 0)) {
      requestDraw();
    } else {
      log.error('Waveform is unavailable after extraction:', fileUrl.value);
    }
  } catch (err) {
    log.error('Failed to extract audio peaks:', err);
  } finally {
    isExtracting.value = false;
    if (hasDeferredExtraction.value && !timelineStore.isPlaying) {
      const latestMaxLength = waveformMaxLength(effectiveSourceDurationUs.value / 1_000_000);
      if (!hasSufficientPeaks(audioPeaks.value, latestMaxLength)) {
        requestPeaksExtraction();
      } else {
        hasDeferredExtraction.value = false;
      }
    }
  }
};

function requestPeaksExtraction() {
  const maxLength = waveformMaxLength(effectiveSourceDurationUs.value / 1_000_000);
  if (hasSufficientPeaks(audioPeaks.value, maxLength)) return;
  if (isExtracting.value) {
    hasDeferredExtraction.value = true;
    return;
  }
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

watch(effectiveSourceDurationUs, () => {
  requestPeaksExtraction();
});

watch(
  () => projectStore.currentProjectId,
  (newId) => {
    if (newId) {
      requestPeaksExtraction();
    }
  },
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

    const maxLength = waveformMaxLength(effectiveSourceDurationUs.value / 1_000_000);
    if (hasDeferredExtraction.value && !hasSufficientPeaks(audioPeaks.value, maxLength)) {
      requestPeaksExtraction();
    }
  },
);

// ---------------------------------------------------------------------------
// Rendering
//
// One canvas per clip (not per chunk). Clips whose waveform strip fits within
// STATIC_MAX_PX are drawn once into a single static canvas covering the whole
// strip — scrolling then costs nothing because the parent content is merely
// transform-translated. Wider clips fall back to a viewport-windowed canvas that
// is redrawn as the visible window moves. All redraws go through a shared,
// frame-budgeted scheduler, and during an active zoom gesture the bitmap is
// stretched via CSS while the backing redraw is deferred until the zoom settles.
// ---------------------------------------------------------------------------

// Largest strip width drawn as a single static canvas. Above this we window the
// canvas to the viewport to stay well under browser canvas size limits.
const STATIC_MAX_PX = 8000;
const WINDOW_OVERSCAN_PX = 1000;
const MAX_WAVEFORM_DRAW_POINTS = 4096;
const ZOOM_SETTLE_MS = 120;

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

const totalWidthPx = computed(() => waveformMetrics.value.totalWidthPx);
const waveformLeftPx = computed(() => waveformMetrics.value.leftPx);

const clipStartPx = computed(() =>
  timeUsToPx(props.item.timelineRange.startUs, timelineStore.timelineZoom),
);

const track = computed(() =>
  timelineStore.timelineDoc?.tracks.find((t) => t.id === props.item.trackId),
);

const isMuted = computed(() => {
  return (
    props.item.audioMuted ||
    track.value?.audioMuted ||
    timelineStore.audioMuted ||
    props.item.disabled ||
    track.value?.videoHidden
  );
});

// Visible sub-rect of the waveform strip, in strip-local pixels. Static clips
// always return the full strip; wide clips return the scrolled viewport window.
const renderWindow = computed<{ leftPx: number; widthPx: number }>(() => {
  const totalW = totalWidthPx.value;
  if (totalW <= 0) return { leftPx: 0, widthPx: 0 };
  if (totalW <= STATIC_MAX_PX) return { leftPx: 0, widthPx: totalW };

  const viewportWidth = props.viewportWidth ?? timelineStore.timelineViewportWidth;
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    return { leftPx: 0, widthPx: Math.min(totalW, STATIC_MAX_PX) };
  }

  const scrollLeft = props.scrollLeft ?? timelineStore.timelineScrollLeftPx;
  const stripStartInTimeline = clipStartPx.value + waveformLeftPx.value;
  const visibleLeft = scrollLeft - stripStartInTimeline;
  const overscan = Math.max(WINDOW_OVERSCAN_PX, viewportWidth * 0.5);

  const left = Math.max(0, Math.floor(visibleLeft - overscan));
  const right = Math.min(totalW, Math.ceil(visibleLeft + viewportWidth + overscan));
  return { leftPx: left, widthPx: Math.max(0, right - left) };
});

function getWaveformPeakId(channels: readonly Float32Array[]) {
  const existing = waveformPeakIds.get(channels);
  if (existing) return existing;
  const id = nextWaveformPeakId++;
  waveformPeakIds.set(channels, id);
  return id;
}

function effectiveDevicePixelRatio(): number {
  // Cap to 1 inside the Tauri webview (WebKitGTK): 2× backing doubles fill cost
  // on HiDPI while adding no perceptible waveform detail.
  if (isTauriRuntime()) return 1;
  return typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
}

function draw() {
  const canvas = canvasEl.value;
  const root = rootEl.value;
  if (!canvas || !root) return;

  const channels = audioPeaks.value;
  if (!channels || channels.length === 0) return;
  const peaksCount = channels[0]?.length || 0;
  if (peaksCount === 0) return;

  const win = renderWindow.value;
  if (win.widthPx <= 0) return;

  const totalW = totalWidthPx.value;
  if (totalW <= 0) return;

  const cssHeight = Math.max(1, canvas.parentElement?.clientHeight || root.clientHeight);
  const cssWidth = Math.max(1, Math.round(win.widthPx));

  const renderBudget = computeWaveformRenderBudget({
    cssWidth,
    devicePixelRatio: effectiveDevicePixelRatio(),
    zoom: timelineStore.timelineZoom,
    maxPointsPerChunk: MAX_WAVEFORM_DRAW_POINTS,
  });

  const targetWidth = Math.max(1, Math.round(cssWidth * renderBudget.effectiveDevicePixelRatio));
  const targetHeight = Math.max(1, Math.round(cssHeight * renderBudget.effectiveDevicePixelRatio));

  // Map the visible window back to peak-sample indices. One extra peak at the end
  // (when available) keeps the line connected to the next window.
  const startRatio = win.leftPx / totalW;
  const endRatio = (win.leftPx + win.widthPx) / totalW;
  const startIndex = Math.floor(startRatio * peaksCount);
  const endIndex = Math.min(peaksCount, Math.ceil(endRatio * peaksCount) + 1);

  const mode = props.item.audioWaveformMode || 'half';
  const muted = isMuted.value;
  const gain = props.item.audioGain ?? 1;
  const peakId = getWaveformPeakId(channels);

  const drawSignature = [
    peakId,
    peaksCount,
    win.leftPx,
    win.widthPx,
    totalW,
    startIndex,
    endIndex,
    renderBudget.outputBins,
    targetWidth,
    targetHeight,
    gain,
    mode,
    muted ? 1 : 0,
  ].join(':');

  if (drawSignature === lastDrawSignature) return;

  if (canvas.width !== targetWidth) canvas.width = targetWidth;
  if (canvas.height !== targetHeight) canvas.height = targetHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const peakBins = computeWaveformPeakBinsFromMips({
    channels,
    startIndex,
    endIndex,
    outputBins: renderBudget.outputBins,
    gain,
  });

  if (peakBins.length <= 0) return;

  const halfH = targetHeight / 2;
  const step = peakBins.length > 1 ? targetWidth / (peakBins.length - 1) : targetWidth;

  ctx.fillStyle = muted ? '#ffffff66' : '#ffffff';
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
    ctx.moveTo(0, halfH);
    for (let i = 0; i < peakBins.length; i++) {
      const x = i * step;
      const y = halfH - Math.min(1, peakBins[i] ?? 0) * halfH;
      ctx.lineTo(x, y);
    }
    for (let i = peakBins.length - 1; i >= 0; i--) {
      const x = i * step;
      const y = halfH + Math.min(1, peakBins[i] ?? 0) * halfH;
      ctx.lineTo(x, y);
    }
  }

  ctx.closePath();
  ctx.fill();
  lastDrawSignature = drawSignature;
}

function requestDraw() {
  scheduleWaveformRedraw(schedulerKey, draw);
}

watch(
  () => timelineStore.timelineZoom,
  () => {
    if (zoomSettleTimer) clearTimeout(zoomSettleTimer);
    zoomSettleTimer = window.setTimeout(() => {
      zoomSettleTimer = 0;
      requestDraw();
    }, ZOOM_SETTLE_MS);
  },
  { flush: 'sync' },
);

// Geometry/scroll changes: the strip + canvas CSS box follow `renderWindow`
// reactively, so the existing bitmap stretches for free during a zoom gesture.
// We only re-rasterize the backing store when the visible window changes — and
// while a zoom gesture is in flight we defer that to the settle timer below.
watch(
  () => [renderWindow.value.leftPx, renderWindow.value.widthPx],
  () => {
    if (zoomSettleTimer) return;
    requestDraw();
  },
);

// Visual-only property changes (no geometry impact) → redraw immediately.
watch(
  () => [props.item.audioWaveformMode, props.item.audioGain, isMuted.value],
  () => requestDraw(),
);

// External peaks updates (cache refresh / late extraction) must trigger a redraw,
// otherwise the canvas stays empty until the user pans/zooms.
watch(audioPeaks, () => {
  if (audioPeaks.value) hasDeferredExtraction.value = false;
  lastDrawSignature = '';
  requestDraw();
});

onMounted(() => {
  isUnmounted = false;
  requestPeaksExtraction();

  resizeObserver = new ResizeObserver(() => {
    lastDrawSignature = '';
    requestDraw();
  });
  if (rootEl.value) resizeObserver.observe(rootEl.value);

  requestDraw();
});

onBeforeUnmount(() => {
  isUnmounted = true;
  extractCallId += 1;
  if (zoomSettleTimer) {
    clearTimeout(zoomSettleTimer);
    zoomSettleTimer = 0;
  }
  cancelWaveformRedraw(schedulerKey);
  resizeObserver?.disconnect();
  resizeObserver = null;
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
      class="absolute inset-y-0 h-full"
      :style="{
        left: `${waveformLeftPx}px`,
        width: `${totalWidthPx}px`,
        transform: isReversed ? 'scaleX(-1)' : undefined,
      }"
    >
      <canvas
        ref="canvasEl"
        class="absolute top-0 h-full max-w-none"
        :style="{
          left: `${renderWindow.leftPx}px`,
          width: `${renderWindow.widthPx}px`,
        }"
      ></canvas>
    </div>
  </div>
</template>
