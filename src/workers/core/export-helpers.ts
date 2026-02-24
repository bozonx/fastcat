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
