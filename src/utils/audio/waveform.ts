import { timeUsToPx, zoomToPxPerSecond } from '~/utils/timeline/geometry';

export interface WaveformWindowMetricsParams {
  sourceStartUs: number;
  sourceDurationUs: number;
  timelineDurationUs: number;
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
  absoluteUs: number;
  clipStartUs: number;
  clipDurationUs: number;
  sourceStartUs: number;
  sourceRangeDurationUs: number;
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

export function normalizeWaveformSpeed(speed: unknown): number {
  const parsed = typeof speed === 'number' && Number.isFinite(speed) ? speed : 1;
  const abs = Math.abs(parsed || 1);
  return Math.max(0.001, Math.min(100, abs));
}

export function computeWaveformWindowMetrics(
  params: WaveformWindowMetricsParams,
): WaveformWindowMetrics {
  const speed = normalizeWaveformSpeed(params.speed);
  const sourceStartUs = Math.max(0, Math.round(params.sourceStartUs));
  const sourceDurationUs = Math.max(0, Math.round(params.sourceDurationUs));
  const timelineDurationUs = Math.max(0, Math.round(params.timelineDurationUs));
  const clipWidthPx = Math.round(timeUsToPx(timelineDurationUs, params.zoom));
  const totalWidthPx = Math.round(timeUsToPx(sourceDurationUs / Math.abs(speed), params.zoom));
  const trimOffsetPx = Math.round(timeUsToPx(sourceStartUs / speed, params.zoom));
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

export function resolveWaveformSourceUs(params: WaveformSourceTimeParams): number | null {
  const clipStartUs = Math.max(0, Math.round(params.clipStartUs));
  const clipDurationUs = Math.max(0, Math.round(params.clipDurationUs));
  const localUs = Math.round(params.absoluteUs) - clipStartUs;
  if (localUs < 0 || localUs > clipDurationUs) return null;

  const sourceStartUs = Math.max(0, Math.round(params.sourceStartUs));
  const sourceRangeDurationUs = Math.max(0, Math.round(params.sourceRangeDurationUs));
  const speed = normalizeWaveformSpeed(params.speed);
  const sourceOffsetUs =
    typeof params.speed === 'number' && Number.isFinite(params.speed) && params.speed < 0
      ? sourceRangeDurationUs + Math.round(localUs * speed)
      : Math.round(localUs * speed);

  return sourceStartUs + Math.min(sourceRangeDurationUs, Math.max(0, sourceOffsetUs));
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

export function deserializeWaveformPeaks(buffer: ArrayBuffer): Float32Array[] | null {
  if (buffer.byteLength < 8) return null;
  const view = new DataView(buffer);
  const channelCount = view.getUint32(0, true);
  const samplesCount = view.getUint32(4, true);
  const expectedByteLength = 8 + channelCount * samplesCount * 4;
  if (buffer.byteLength < expectedByteLength) return null;

  const floatArray = new Float32Array(buffer, 8);
  const peaks: Float32Array[] = [];
  for (let ch = 0; ch < channelCount; ch++) {
    const channelData = new Float32Array(samplesCount);
    channelData.set(floatArray.subarray(ch * samplesCount, (ch + 1) * samplesCount));
    peaks.push(channelData);
  }
  return peaks;
}
