export interface ResolveClipSourceTimeUsParams {
  localTimeUs: number;
  sourceStartUs: number;
  sourceRangeDurationUs: number;
  speed?: number;
  frameRate?: number;
}

export const MIN_SOURCE_TIME_END_GUARD_US = 1_000;

export function normalizeClipSpeed(speed: unknown): number {
  return typeof speed === 'number' && Number.isFinite(speed) && speed !== 0
    ? Math.max(-10, Math.min(10, speed))
    : 1;
}

export function clampToLastReadableSourceUs(durationUs: number, frameRate?: number): number {
  const halfFrameUs =
    typeof frameRate === 'number' && Number.isFinite(frameRate) && frameRate > 0
      ? Math.round(500_000 / frameRate)
      : 0;
  const guard = Math.max(MIN_SOURCE_TIME_END_GUARD_US, halfFrameUs);
  return Math.max(0, Math.round(durationUs) - guard);
}

export function resolveClipSourceTimeUs(params: ResolveClipSourceTimeUsParams): number {
  const sourceStartUs = Math.max(0, Math.round(params.sourceStartUs));
  const sourceRangeDurationUs = Math.max(0, Math.round(params.sourceRangeDurationUs));
  if (sourceRangeDurationUs <= 0) return sourceStartUs;

  const speed = normalizeClipSpeed(params.speed);
  const absSpeed = Math.abs(speed);
  const localTimeUs = Math.max(0, Math.round(params.localTimeUs));
  const sourceDeltaUs = Math.round(localTimeUs * absSpeed);
  const lastRangeUs = clampToLastReadableSourceUs(sourceRangeDurationUs, params.frameRate);

  const sourceOffsetUs =
    speed < 0
      ? Math.max(0, lastRangeUs - sourceDeltaUs)
      : Math.min(lastRangeUs, Math.max(0, sourceDeltaUs));

  return sourceStartUs + sourceOffsetUs;
}
