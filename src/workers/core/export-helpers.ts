import { usToS } from './time';

export interface ClipRangesS {
  timelineStartS: number;
  sourceStartS: number;
  sourceEndS: number;
}

export function getClipRangesS(clip: any): ClipRangesS {
  const timelineStartUs = Number(clip.timelineRange?.startUs || 0);
  const timelineDurationUs = Number(clip.timelineRange?.durationUs || 0);
  const sourceStartUs = Number(clip.sourceRange?.startUs || 0);
  const sourceDurationUs = Number(clip.sourceRange?.durationUs || timelineDurationUs || 0);

  const timelineStartS = Math.max(0, usToS(timelineStartUs));
  const sourceStartS = Math.max(0, usToS(sourceStartUs));
  const durationS = Math.max(0, usToS(sourceDurationUs));

  return {
    timelineStartS,
    sourceStartS,
    sourceEndS: sourceStartS + durationS,
  };
}

export function computeMaxAudioDurationUs(clips: any[]): number {
  return clips.reduce((max, clip) => {
    const endUs =
      Number(clip.timelineRange?.startUs || 0) + Number(clip.timelineRange?.durationUs || 0);
    return Math.max(max, endUs);
  }, 0);
}

export interface ExportFrameTiming {
  frameNum: number;
  timeUs: number;
  timestampS: number;
  durationS: number;
}

function normalizeExportFps(fps: number): number {
  const value = Number(fps);
  return Number.isFinite(value) && value > 0 ? value : 30;
}

export function computeExportTotalFrames(params: { durationUs: number; fps: number }): number {
  const durationUs = Math.max(0, Math.round(Number(params.durationUs) || 0));
  const fps = normalizeExportFps(params.fps);
  return Math.ceil((durationUs * fps) / 1_000_000);
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
  const frameStartUs = Math.round((frameNum * 1_000_000) / fps);
  const nextFrameStartUs = Math.round(((frameNum + 1) * 1_000_000) / fps);
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
