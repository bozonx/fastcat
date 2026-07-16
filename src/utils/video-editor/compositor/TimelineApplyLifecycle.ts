import type { CompositorClip } from './types';

export interface TimelineApplyLifecycleParams {
  previousClipById: Map<string, CompositorClip>;
  replacedClipIds: Set<string>;
  nextClips: CompositorClip[];
  nextClipById: Map<string, CompositorClip>;
  sequentialTimeTicks: number;
  destroyClip: (clip: CompositorClip) => void;
}

export interface TimelineApplyLifecycleResult {
  clips: CompositorClip[];
  clipById: Map<string, CompositorClip>;
  maxDurationTicks: number;
  lastRenderedTimeTicks: number;
  stageSortDirty: boolean;
  activeSortDirty: boolean;
}

export class TimelineApplyLifecycle {
  public apply(params: TimelineApplyLifecycleParams): TimelineApplyLifecycleResult {
    const {
      previousClipById,
      replacedClipIds,
      nextClips,
      nextClipById,
      sequentialTimeTicks,
      destroyClip,
    } = params;

    for (const [prevId, prevClip] of previousClipById.entries()) {
      if (replacedClipIds.has(prevId)) {
        continue;
      }
      if (!nextClipById.has(prevId)) {
        destroyClip(prevClip);
      }
    }
    replacedClipIds.clear();

    nextClips.sort((a, b) => a.startTicks - b.startTicks || a.layer - b.layer);
    const maxClipEndTicks =
      nextClips.length > 0 ? Math.max(0, ...nextClips.map((clip) => clip.endTicks)) : 0;
    const maxDurationTicks = Math.max(maxClipEndTicks, sequentialTimeTicks);

    return {
      clips: nextClips,
      clipById: nextClipById,
      maxDurationTicks,
      // Force the next renderFrame to run a full pass instead of early-exiting.
      // A freshly loaded timeline (e.g. a newly created empty one) requests its
      // first render at timeTicks 0 with no dirty clips; if we reset to 0 here, the
      // RenderingEngine early-exit (timeTicks === lastRenderedTimeTicks) keeps the stale
      // canvas, leaving the previous timeline's frame on screen. NaN never matches.
      lastRenderedTimeTicks: Number.NaN,
      stageSortDirty: true,
      activeSortDirty: true,
    };
  }
}
