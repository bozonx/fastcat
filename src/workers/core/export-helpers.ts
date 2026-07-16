import { ticksToSecondsClamped } from './time';
import { TICKS_PER_SECOND } from '~/utils/time';

export interface ClipRangesS {
  timelineStartS: number;
  sourceStartS: number;
  sourceEndS: number;
}

export function getClipRangesS(clip: unknown): ClipRangesS {
  const c = clip as Record<string, unknown>;
  const timelineRange = c.timelineRange as Record<string, unknown> | undefined;
  const sourceRange = c.sourceRange as Record<string, unknown> | undefined;
  const timelineStartTicks = Number(timelineRange?.startTicks ?? 0);
  const timelineDurationTicks = Number(timelineRange?.durationTicks ?? 0);
  const sourceStartTicks = Number(sourceRange?.startTicks ?? 0);
  const sourceDurationTicks = Number(sourceRange?.durationTicks ?? timelineDurationTicks ?? 0);

  const timelineStartS = Math.max(0, ticksToSecondsClamped(timelineStartTicks));
  const sourceStartS = Math.max(0, ticksToSecondsClamped(sourceStartTicks));
  const durationS = Math.max(0, ticksToSecondsClamped(sourceDurationTicks));

  return {
    timelineStartS,
    sourceStartS,
    sourceEndS: sourceStartS + durationS,
  };
}

export function computeMaxAudioDurationTicks(clips: unknown[]): number {
  return clips.reduce<number>((max, clip) => {
    const c = clip as Record<string, unknown>;
    const timelineRange = c.timelineRange as Record<string, unknown> | undefined;
    const endTicks =
      Number(timelineRange?.startTicks ?? 0) + Number(timelineRange?.durationTicks ?? 0);
    return Math.max(max, endTicks);
  }, 0);
}

export interface ExportFrameTiming {
  frameNum: number;
  timeTicks: number;
  timestampS: number;
  durationS: number;
}

export interface ExportFpsRatio {
  numerator: number;
  denominator: number;
}

function normalizeExportFps(fps: number): ExportFpsRatio {
  const value = Number(fps);
  const normalized = Number.isFinite(value) && value > 0 ? value : 30;
  const commonRates: ExportFpsRatio[] = [
    { numerator: 24_000, denominator: 1_001 },
    { numerator: 30_000, denominator: 1_001 },
    { numerator: 60_000, denominator: 1_001 },
    { numerator: 120_000, denominator: 1_001 },
  ];

  for (const ratio of commonRates) {
    if (Math.abs(normalized - ratio.numerator / ratio.denominator) < 0.001) {
      return ratio;
    }
  }

  const denominator = 1_000_000;
  const numerator = Math.max(1, Math.round(normalized * denominator));
  const divisor = gcd(numerator, denominator);
  return {
    numerator: numerator / divisor,
    denominator: denominator / divisor,
  };
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y > 0) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x || 1;
}

function rationalFrameTimeTicks(frameNum: number, fps: ExportFpsRatio): number {
  return Number(
    (BigInt(frameNum) * BigInt(TICKS_PER_SECOND) * BigInt(fps.denominator) +
      BigInt(Math.floor(fps.numerator / 2))) /
      BigInt(fps.numerator),
  );
}

export function computeExportTotalFrames(params: { durationTicks: number; fps: number }): number {
  const durationTicks = Math.max(0, Math.round(Number(params.durationTicks) || 0));
  const fps = normalizeExportFps(params.fps);
  const divisor = BigInt(TICKS_PER_SECOND) * BigInt(fps.denominator);
  const value = BigInt(durationTicks) * BigInt(fps.numerator);
  return Number((value + divisor / 2n) / divisor);
}

export function computeExportFrameInterval(params: {
  intervalSec: number | undefined;
  fps: number;
}): number | undefined {
  const intervalSec = Number(params.intervalSec);
  if (!Number.isFinite(intervalSec) || intervalSec <= 0) {
    return undefined;
  }

  const fps = normalizeExportFps(params.fps);
  return Math.max(1, Math.round((intervalSec * fps.numerator) / fps.denominator));
}

export function getExportFrameTiming(params: {
  frameNum: number;
  totalFrames: number;
  durationTicks: number;
  fps: number;
}): ExportFrameTiming {
  const fps = normalizeExportFps(params.fps);
  const frameNum = Math.max(0, Math.round(Number(params.frameNum) || 0));
  const totalFrames = Math.max(0, Math.round(Number(params.totalFrames) || 0));
  const durationTicks = Math.max(0, Math.round(Number(params.durationTicks) || 0));
  const frameStartTicks = rationalFrameTimeTicks(frameNum, fps);
  const nextFrameStartTicks = rationalFrameTimeTicks(frameNum + 1, fps);
  const clampedStartTicks = Math.min(frameStartTicks, durationTicks);
  const clampedNextFrameStartTicks = Math.min(nextFrameStartTicks, durationTicks);
  const frameDurationTicks = Math.max(1, clampedNextFrameStartTicks - clampedStartTicks);
  const durationS = totalFrames > 0 ? frameDurationTicks / TICKS_PER_SECOND : 0;

  return {
    frameNum,
    timeTicks: clampedStartTicks,
    timestampS: clampedStartTicks / TICKS_PER_SECOND,
    durationS,
  };
}
