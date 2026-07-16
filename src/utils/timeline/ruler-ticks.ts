import { frameToTicks } from '~/timeline/commands/utils';
import { timeUsToPx } from '~/utils/timeline/geometry';

export interface TimelineRulerStepInput {
  pxPerSecond: number;
  interfaceScale: number;
}

export interface TimelineRulerFrameRangeInput {
  startFrame: number;
  endFrame: number;
  mainStepFrames: number;
}

export function getTimelineRulerMainStepS(input: TimelineRulerStepInput): number {
  const scale = input.interfaceScale / 14;
  const minDistancePx = 90 * scale;
  const timeStepsS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];

  for (const step of timeStepsS) {
    if (step * input.pxPerSecond >= minDistancePx) {
      return step;
    }
  }

  return timeStepsS[timeStepsS.length - 1]!;
}

export function getTimelineRulerSubStepFrames(params: { mainStepS: number; fps: number }): number {
  let subStepS = 1;
  if (params.mainStepS >= 60) subStepS = 10;
  else if (params.mainStepS >= 10) subStepS = 5;
  else if (params.mainStepS >= 5) subStepS = 1;

  return Math.max(1, Math.round(subStepS * params.fps));
}

export function getFirstTimelineRulerMajorFrame(input: TimelineRulerFrameRangeInput): number {
  return Math.floor(input.startFrame / input.mainStepFrames) * input.mainStepFrames;
}

export function getTimelineTickCanvasX(params: {
  timeTicks: number;
  zoom: number;
  renderStartPx: number;
}): number {
  return Math.round(timeUsToPx(params.timeTicks, params.zoom)) - params.renderStartPx + 0.5;
}

export function getTimelineFrameTickCanvasX(params: {
  frame: number;
  fps: number;
  zoom: number;
  renderStartPx: number;
}): number {
  return getTimelineTickCanvasX({
    timeTicks: frameToTicks(params.frame, params.fps),
    zoom: params.zoom,
    renderStartPx: params.renderStartPx,
  });
}
