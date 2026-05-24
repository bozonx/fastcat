import { usToS } from './time';

export interface ClipRangesS {
  timelineStartS: number;
  sourceStartS: number;
  sourceEndS: number;
}

export function getClipRangesS(clip: unknown): ClipRangesS {
  const c = clip as Record<string, unknown>;
  const timelineRange = c.timelineRange as Record<string, unknown> | undefined;
  const sourceRange = c.sourceRange as Record<string, unknown> | undefined;
  const timelineStartUs = Number(timelineRange?.startUs ?? 0);
  const timelineDurationUs = Number(timelineRange?.durationUs ?? 0);
  const sourceStartUs = Number(sourceRange?.startUs ?? 0);
  const sourceDurationUs = Number(sourceRange?.durationUs ?? timelineDurationUs ?? 0);

  const timelineStartS = Math.max(0, usToS(timelineStartUs));
  const sourceStartS = Math.max(0, usToS(sourceStartUs));
  const durationS = Math.max(0, usToS(sourceDurationUs));

  return {
    timelineStartS,
    sourceStartS,
    sourceEndS: sourceStartS + durationS,
  };
}

export function computeMaxAudioDurationUs(clips: unknown[]): number {
  return clips.reduce<number>((max, clip) => {
    const c = clip as Record<string, unknown>;
    const timelineRange = c.timelineRange as Record<string, unknown> | undefined;
    const endUs = Number(timelineRange?.startUs ?? 0) + Number(timelineRange?.durationUs ?? 0);
    return Math.max(max, endUs);
  }, 0);
}

export interface ExportFrameTiming {
  frameNum: number;
  timeUs: number;
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

function rationalFrameTimeUs(frameNum: number, fps: ExportFpsRatio): number {
  return Number(
    (BigInt(frameNum) * 1_000_000n * BigInt(fps.denominator) +
      BigInt(Math.floor(fps.numerator / 2))) /
      BigInt(fps.numerator),
  );
}

export function computeExportTotalFrames(params: { durationUs: number; fps: number }): number {
  const durationUs = Math.max(0, Math.round(Number(params.durationUs) || 0));
  const fps = normalizeExportFps(params.fps);
  const divisor = 1_000_000n * BigInt(fps.denominator);
  const value = BigInt(durationUs) * BigInt(fps.numerator);
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
  durationUs: number;
  fps: number;
}): ExportFrameTiming {
  const fps = normalizeExportFps(params.fps);
  const frameNum = Math.max(0, Math.round(Number(params.frameNum) || 0));
  const totalFrames = Math.max(0, Math.round(Number(params.totalFrames) || 0));
  const durationUs = Math.max(0, Math.round(Number(params.durationUs) || 0));
  const frameStartUs = rationalFrameTimeUs(frameNum, fps);
  const nextFrameStartUs = rationalFrameTimeUs(frameNum + 1, fps);
  const clampedStartUs = Math.min(frameStartUs, durationUs);
  const clampedNextFrameStartUs = Math.min(nextFrameStartUs, durationUs);
  const frameDurationUs = Math.max(1, clampedNextFrameStartUs - clampedStartUs);
  const durationS = totalFrames > 0 ? frameDurationUs / 1_000_000 : 0;

  return {
    frameNum,
    timeUs: clampedStartUs,
    timestampS: clampedStartUs / 1_000_000,
    durationS,
  };
}
