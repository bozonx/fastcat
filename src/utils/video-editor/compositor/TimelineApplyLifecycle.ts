import type { CompositorClip } from './types';

export interface TimelineApplyLifecycleParams {
  previousClipById: Map<string, CompositorClip>;
  replacedClipIds: Set<string>;
  nextClips: CompositorClip[];
  nextClipById: Map<string, CompositorClip>;
  sequentialTimeUs: number;
  destroyClip: (clip: CompositorClip) => void;
}

export interface TimelineApplyLifecycleResult {
  clips: CompositorClip[];
  clipById: Map<string, CompositorClip>;
  maxDurationUs: number;
  lastRenderedTimeUs: number;
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
      sequentialTimeUs,
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

    nextClips.sort((a, b) => a.startUs - b.startUs || a.layer - b.layer);
    const maxClipEndUs =
      nextClips.length > 0 ? Math.max(0, ...nextClips.map((clip) => clip.endUs)) : 0;
    const maxDurationUs = Math.max(maxClipEndUs, sequentialTimeUs);

    return {
      clips: nextClips,
      clipById: nextClipById,
      maxDurationUs,
      lastRenderedTimeUs: 0,
      stageSortDirty: true,
      activeSortDirty: true,
    };
  }
}
