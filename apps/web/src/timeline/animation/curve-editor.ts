import type { Keyframe, KeyframeTrack } from '~/timeline/types';
import { evalTrackAt } from './evaluate';

export interface CurveValueRange {
  min: number;
  max: number;
}

export interface CurvePoint {
  x: number;
  y: number;
}

export interface BuildCurvePolylineParams {
  track: KeyframeTrack;
  durationTicks: number;
  widthPx: number;
  heightPx: number;
  paddingPx: number;
}

export interface CurveYParams {
  range: CurveValueRange;
  heightPx: number;
  paddingPx: number;
}

export interface ValueToCurveYParams extends CurveYParams {
  value: number;
}

export interface CurveYToValueParams extends CurveYParams {
  y: number;
}

export interface KeyframeToCurvePointParams extends CurveYParams {
  keyframe: Keyframe;
  durationTicks: number;
  widthPx: number;
}

export function resolveCurveValueRange(track: KeyframeTrack | undefined): CurveValueRange {
  const values = track?.keyframes
    .map((keyframe) => keyframe.value)
    .filter((value) => Number.isFinite(value));
  if (!values?.length) return { min: 0, max: 1 };

  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min !== max) return { min, max };

  const pad = Math.max(1, Math.abs(min) * 0.1);
  return { min: min - pad, max: max + pad };
}

export function valueToCurveY(params: ValueToCurveYParams): number {
  const usableHeight = Math.max(1, params.heightPx - params.paddingPx * 2);
  const span = Math.max(1e-9, params.range.max - params.range.min);
  const normalized = (params.value - params.range.min) / span;
  return params.paddingPx + (1 - normalized) * usableHeight;
}

export function curveYToValue(params: CurveYToValueParams): number {
  const usableHeight = Math.max(1, params.heightPx - params.paddingPx * 2);
  const clampedY = Math.max(
    params.paddingPx,
    Math.min(params.heightPx - params.paddingPx, params.y),
  );
  const normalized = 1 - (clampedY - params.paddingPx) / usableHeight;
  return params.range.min + normalized * (params.range.max - params.range.min);
}

export function keyframeToCurvePoint(params: KeyframeToCurvePointParams): CurvePoint {
  const safeDurationTicks = Math.max(1, params.durationTicks);
  return {
    x:
      (Math.max(0, Math.min(safeDurationTicks, params.keyframe.tTicks)) / safeDurationTicks) *
      params.widthPx,
    y: valueToCurveY({
      value: params.keyframe.value,
      range: params.range,
      heightPx: params.heightPx,
      paddingPx: params.paddingPx,
    }),
  };
}

export function buildCurvePolyline(params: BuildCurvePolylineParams): CurvePoint[] {
  const range = resolveCurveValueRange(params.track);
  const durationTicks = Math.max(1, params.durationTicks);
  const widthPx = Math.max(1, Math.round(params.widthPx));
  const points: CurvePoint[] = [];

  for (let x = 0; x <= widthPx; x++) {
    const tTicks = (x / widthPx) * durationTicks;
    const value = evalTrackAt(params.track, tTicks);
    if (value === undefined) continue;
    points.push({
      x,
      y: valueToCurveY({
        value,
        range,
        heightPx: params.heightPx,
        paddingPx: params.paddingPx,
      }),
    });
  }

  return points;
}
