import { timeUsToPx } from '~/utils/timeline/geometry';

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
  const totalWidthPx = Math.round(timeUsToPx(sourceDurationUs / speed, params.zoom));
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
      ? sourceRangeDurationUs - Math.round(localUs * speed)
      : Math.round(localUs * speed);

  return sourceStartUs + Math.min(sourceRangeDurationUs, Math.max(0, sourceOffsetUs));
}
