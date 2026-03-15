import type { CompositorClip } from './types';

export interface TimelineUpdateLifecycleResult {
  clips: CompositorClip[];
  maxDurationUs: number;
  lastRenderedTimeUs: number;
  stageSortDirty: boolean;
  activeSortDirty: boolean;
}

export class TimelineUpdateLifecycle {
  public apply(clips: CompositorClip[]): TimelineUpdateLifecycleResult {
    clips.sort((a, b) => a.startUs - b.startUs || a.layer - b.layer);

    const maxDurationUs = clips.length > 0 ? Math.max(0, ...clips.map((clip) => clip.endUs)) : 0;

    return {
      clips,
      maxDurationUs,
      lastRenderedTimeUs: Number.NaN,
      stageSortDirty: true,
      activeSortDirty: true,
    };
  }
}
