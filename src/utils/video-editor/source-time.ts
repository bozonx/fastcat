import { TICKS_PER_MILLISECOND, TICKS_PER_SECOND } from '~/utils/time';

export interface ResolveClipSourceTimeTicksParams {
  localTimeTicks: number;
  sourceStartTicks: number;
  sourceRangeDurationTicks: number;
  speed?: number;
  frameRate?: number;
}

/** 1 ms guard expressed in canonical timeline ticks. */
export const MIN_SOURCE_TIME_END_GUARD_TICKS = TICKS_PER_MILLISECOND;

export function normalizeClipSpeed(speed: unknown): number {
  return typeof speed === 'number' && Number.isFinite(speed) && speed !== 0
    ? Math.max(-10, Math.min(10, speed))
    : 1;
}

export function clampToLastReadableSourceTicks(durationTicks: number, frameRate?: number): number {
  const halfFrameTicks =
    typeof frameRate === 'number' && Number.isFinite(frameRate) && frameRate > 0
      ? Math.round(TICKS_PER_SECOND / (2 * frameRate))
      : 0;
  const guard = Math.max(MIN_SOURCE_TIME_END_GUARD_TICKS, halfFrameTicks);
  return Math.max(0, Math.round(durationTicks) - guard);
}

export function resolveClipSourceTimeTicks(params: ResolveClipSourceTimeTicksParams): number {
  const sourceStartTicks = Math.max(0, Math.round(params.sourceStartTicks));
  const sourceRangeDurationTicks = Math.max(0, Math.round(params.sourceRangeDurationTicks));
  if (sourceRangeDurationTicks <= 0) return sourceStartTicks;

  const speed = normalizeClipSpeed(params.speed);
  const absSpeed = Math.abs(speed);
  const localTimeTicks = Math.max(0, Math.round(params.localTimeTicks));
  const sourceDeltaTicks = Math.round(localTimeTicks * absSpeed);
  const lastRangeTicks = clampToLastReadableSourceTicks(sourceRangeDurationTicks, params.frameRate);

  const sourceOffsetTicks =
    speed < 0
      ? Math.max(0, lastRangeTicks - sourceDeltaTicks)
      : Math.min(lastRangeTicks, Math.max(0, sourceDeltaTicks));

  return sourceStartTicks + sourceOffsetTicks;
}
