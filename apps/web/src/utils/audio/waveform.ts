import { ticksToPx, zoomToPxPerSecond } from '~/utils/timeline/geometry';

/**
 * Hard ceiling on the number of peak samples per channel. Must mirror
 * `MAX_PEAK_LENGTH` in `src-tauri/src/audio/peaks.rs` so the JS-side resolution
 * budget never asks for more than the native extractor will ever return.
 */
export const MAX_WAVEFORM_PEAK_LENGTH = 500_000;
export const MIN_WAVEFORM_PEAK_LENGTH = 8_000;
export const WAVEFORM_PEAKS_PER_SECOND = 48_000;

export interface WaveformWindowMetricsParams {
  sourceStartTicks: number;
  sourceDurationTicks: number;
  timelineDurationTicks: number;
  speed?: number;
  zoom: number;
}

export interface WaveformWindowMetrics {
  clipWidthPx: number;
  totalWidthPx: number;
  trimOffsetPx: number;
  leftPx: number;
  reversed: boolean;
}

export interface WaveformSourceTimeParams {
  absoluteTicks: number;
  clipStartTicks: number;
  clipDurationTicks: number;
  sourceStartTicks: number;
  sourceRangeDurationTicks: number;
  speed?: number;
}

export interface WaveformPeakBinsParams {
  channels: readonly Float32Array[];
  startIndex: number;
  endIndex: number;
  outputBins: number;
  gain?: number;
}

export interface WaveformRenderBudgetParams {
  cssWidth: number;
  devicePixelRatio: number;
  zoom: number;
  maxPointsPerChunk?: number;
}

export interface WaveformRenderBudget {
  effectiveDevicePixelRatio: number;
  outputBins: number;
}

export function computeWaveformPeakLength(durationS: number): number {
  const safeDurationS = typeof durationS === 'number' && Number.isFinite(durationS) ? durationS : 0;
  const requested = Math.max(
    MIN_WAVEFORM_PEAK_LENGTH,
    Math.ceil(Math.max(0, safeDurationS) * WAVEFORM_PEAKS_PER_SECOND),
  );
  return Math.min(MAX_WAVEFORM_PEAK_LENGTH, requested);
}

export function normalizeWaveformSpeed(speed: unknown): number {
  const parsed = typeof speed === 'number' && Number.isFinite(speed) ? speed : 1;
  const abs = Math.abs(parsed || 1);
  return Math.max(0.001, Math.min(100, abs));
}

export function computeWaveformWindowMetrics(
  params: WaveformWindowMetricsParams,
): WaveformWindowMetrics {
  const speed = normalizeWaveformSpeed(params.speed);
  const sourceStartTicks = Math.max(0, Math.round(params.sourceStartTicks));
  const sourceDurationTicks = Math.max(0, Math.round(params.sourceDurationTicks));
  const timelineDurationTicks = Math.max(0, Math.round(params.timelineDurationTicks));
  const clipWidthPx = Math.round(ticksToPx(timelineDurationTicks, params.zoom));
  // `speed` is already normalized to a positive magnitude; direction is handled
  // separately via `reversed`, so both metrics divide by the same positive speed.
  const totalWidthPx = Math.round(ticksToPx(sourceDurationTicks / speed, params.zoom));
  const trimOffsetPx = Math.round(ticksToPx(sourceStartTicks / speed, params.zoom));
  const reversed =
    typeof params.speed === 'number' && Number.isFinite(params.speed) && params.speed < 0;
  const leftPx = reversed ? trimOffsetPx + clipWidthPx - totalWidthPx : -trimOffsetPx;

  return {
    clipWidthPx,
    totalWidthPx,
    trimOffsetPx,
    leftPx,
    reversed,
  };
}

export function resolveWaveformSourceTicks(params: WaveformSourceTimeParams): number | null {
  const clipStartTicks = Math.max(0, Math.round(params.clipStartTicks));
  const clipDurationTicks = Math.max(0, Math.round(params.clipDurationTicks));
  const localTicks = Math.round(params.absoluteTicks) - clipStartTicks;
  if (localTicks < 0 || localTicks > clipDurationTicks) return null;

  const sourceStartTicks = Math.max(0, Math.round(params.sourceStartTicks));
  const sourceRangeDurationTicks = Math.max(0, Math.round(params.sourceRangeDurationTicks));
  const speed = normalizeWaveformSpeed(params.speed);
  const signedSpeed =
    typeof params.speed === 'number' && Number.isFinite(params.speed) ? params.speed : 1;
  const sourceOffsetTicks =
    signedSpeed < 0
      ? sourceRangeDurationTicks + Math.round(localTicks * signedSpeed)
      : Math.round(localTicks * speed);

  return sourceStartTicks + Math.min(sourceRangeDurationTicks, Math.max(0, sourceOffsetTicks));
}

export function computeWaveformPeakBins(params: WaveformPeakBinsParams): Float32Array {
  const peaksCount = params.channels[0]?.length ?? 0;
  if (params.channels.length === 0 || peaksCount <= 0) return new Float32Array();

  const startIndex = Math.max(0, Math.min(peaksCount, Math.floor(params.startIndex)));
  const endIndex = Math.max(startIndex, Math.min(peaksCount, Math.ceil(params.endIndex)));
  const sourceLength = endIndex - startIndex;
  if (sourceLength <= 0) return new Float32Array();

  const binCount = Math.max(1, Math.min(sourceLength, Math.floor(params.outputBins)));
  const gain = typeof params.gain === 'number' && Number.isFinite(params.gain) ? params.gain : 1;
  const bins = new Float32Array(binCount);

  for (let binIndex = 0; binIndex < binCount; binIndex++) {
    const binStart = startIndex + Math.floor((binIndex * sourceLength) / binCount);
    const binEnd = Math.max(
      binStart + 1,
      startIndex + Math.ceil(((binIndex + 1) * sourceLength) / binCount),
    );

    let peak = 0;
    for (let sampleIndex = binStart; sampleIndex < binEnd; sampleIndex++) {
      for (let channelIndex = 0; channelIndex < params.channels.length; channelIndex++) {
        const value = Math.abs(params.channels[channelIndex]?.[sampleIndex] ?? 0);
        if (value > peak) peak = value;
      }
    }
    bins[binIndex] = peak * gain;
  }

  return bins;
}

export function computeWaveformRenderBudget(
  params: WaveformRenderBudgetParams,
): WaveformRenderBudget {
  const cssWidth = Math.max(1, Math.round(params.cssWidth));
  const maxPointsPerChunk = Math.max(1, Math.floor(params.maxPointsPerChunk ?? 2048));
  const rawDpr =
    typeof params.devicePixelRatio === 'number' && Number.isFinite(params.devicePixelRatio)
      ? params.devicePixelRatio
      : 1;
  const pxPerSecond = zoomToPxPerSecond(params.zoom);

  const effectiveDevicePixelRatio = pxPerSecond < 6 ? 1 : Math.min(2, Math.max(1, rawDpr));
  const pointsPerCssPixel = pxPerSecond < 6 ? 0.5 : pxPerSecond < 12 ? 0.75 : 1;
  const outputBins = Math.max(
    1,
    Math.min(maxPointsPerChunk, Math.ceil(cssWidth * pointsPerCssPixel)),
  );

  return {
    effectiveDevicePixelRatio,
    outputBins,
  };
}

export function serializeWaveformPeaks(peaks: Float32Array[]): ArrayBuffer {
  const channelCount = peaks.length;
  const samplesCount = channelCount > 0 ? peaks[0]!.length : 0;
  const headerByteLength = 8;
  const dataByteLength = channelCount * samplesCount * 4;
  const buffer = new ArrayBuffer(headerByteLength + dataByteLength);
  const view = new DataView(buffer);
  view.setUint32(0, channelCount, true);
  view.setUint32(4, samplesCount, true);

  const floatArray = new Float32Array(buffer, headerByteLength);
  for (let ch = 0; ch < channelCount; ch++) {
    const channelPeaks = peaks[ch];
    if (channelPeaks) {
      floatArray.set(channelPeaks, ch * samplesCount);
    }
  }
  return buffer;
}

/**
 * Source fingerprint stored alongside on-disk waveform peaks so a cached blob
 * can be validated against the file it was generated from. Without this, a blob
 * keyed only by path could be served for a different file later occupying the
 * same path once the metadata cache (which does carry size/mtime) is gone.
 */
export interface WaveformCacheFingerprint {
  size: number;
  lastModified: number;
}

// First byte of the disk-cache envelope. Chosen so the format is distinguishable
// from the two legacy on-disk encodings: JSON (starts with '[' = 0x5b) and the
// raw transport blob (starts with a little-endian channel count, low byte 0..8).
const WAVEFORM_CACHE_MAGIC = 0xf0;
const WAVEFORM_CACHE_VERSION = 1;
const WAVEFORM_CACHE_HEADER_BYTES = 24;

/**
 * Wraps serialized peaks in a versioned envelope carrying the source fingerprint.
 * Used only for the on-disk cache; the IPC transport keeps the bare peak format.
 */
export function serializeWaveformCacheEntry(
  peaks: Float32Array[],
  fingerprint: WaveformCacheFingerprint,
): ArrayBuffer {
  const payload = serializeWaveformPeaks(peaks);
  const buffer = new ArrayBuffer(WAVEFORM_CACHE_HEADER_BYTES + payload.byteLength);
  const view = new DataView(buffer);
  view.setUint8(0, WAVEFORM_CACHE_MAGIC);
  view.setUint8(1, WAVEFORM_CACHE_VERSION);
  // bytes 2..8 reserved (zero), keeping the f64 fields 8-byte aligned.
  view.setFloat64(8, fingerprint.size, true);
  view.setFloat64(16, fingerprint.lastModified, true);
  new Uint8Array(buffer, WAVEFORM_CACHE_HEADER_BYTES).set(new Uint8Array(payload));
  return buffer;
}

/**
 * Reads a disk-cache envelope. Returns `null` when the buffer is not in the
 * envelope format (caller should fall back to legacy decoding) or is corrupt.
 */
export function readWaveformCacheEntry(
  buffer: ArrayBuffer,
): { fingerprint: WaveformCacheFingerprint; peaks: Float32Array[] } | null {
  if (buffer.byteLength < WAVEFORM_CACHE_HEADER_BYTES) return null;
  const view = new DataView(buffer);
  if (view.getUint8(0) !== WAVEFORM_CACHE_MAGIC) return null;
  if (view.getUint8(1) !== WAVEFORM_CACHE_VERSION) return null;

  const fingerprint: WaveformCacheFingerprint = {
    size: view.getFloat64(8, true),
    lastModified: view.getFloat64(16, true),
  };
  const peaks = deserializeWaveformPeaks(buffer.slice(WAVEFORM_CACHE_HEADER_BYTES));
  if (!peaks) return null;
  return { fingerprint, peaks };
}

export function isWaveformCacheEntry(buffer: ArrayBuffer): boolean {
  return buffer.byteLength >= 2 && new DataView(buffer).getUint8(0) === WAVEFORM_CACHE_MAGIC;
}

export function deserializeWaveformPeaks(buffer: ArrayBuffer): Float32Array[] | null {
  if (buffer.byteLength < 8) return null;
  const view = new DataView(buffer);
  const channelCount = view.getUint32(0, true);
  const samplesCount = view.getUint32(4, true);
  const expectedByteLength = 8 + channelCount * samplesCount * 4;
  if (buffer.byteLength < expectedByteLength) return null;

  try {
    // Copy out of the trailing payload. Reading the whole tail as a Float32Array
    // would throw if `(byteLength - 8)` is not 4-aligned, so bound it explicitly.
    const floatArray = new Float32Array(buffer, 8, channelCount * samplesCount);
    const peaks: Float32Array[] = [];
    for (let ch = 0; ch < channelCount; ch++) {
      const channelData = new Float32Array(samplesCount);
      channelData.set(floatArray.subarray(ch * samplesCount, (ch + 1) * samplesCount));
      peaks.push(channelData);
    }
    return peaks;
  } catch {
    return null;
  }
}
