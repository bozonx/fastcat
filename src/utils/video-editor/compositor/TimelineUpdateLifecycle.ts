import type { CompositorClip } from './types';

export interface TimelineUpdateLifecycleResult {
  clips: CompositorClip[];
  maxDurationTicks: number;
  lastRenderedTimeTicks: number;
  stageSortDirty: boolean;
  activeSortDirty: boolean;
}

export class TimelineUpdateLifecycle {
  public apply(clips: CompositorClip[]): TimelineUpdateLifecycleResult {
    clips.sort((a, b) => a.startTicks - b.startTicks || a.layer - b.layer);

    const maxDurationTicks = clips.length > 0 ? Math.max(0, ...clips.map((clip) => clip.endTicks)) : 0;

    return {
      clips,
      maxDurationTicks,
      lastRenderedTimeTicks: Number.NaN,
      stageSortDirty: true,
      activeSortDirty: true,
    };
  }
}
