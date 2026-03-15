import type { CompositorClip, CompositorTrack } from './types';
import { TimelineClipLayoutUpdater } from './TimelineClipLayoutUpdater';
import { TimelineTrackRebinder } from './TimelineTrackRebinder';
import {
  TimelineUpdateLifecycle,
  type TimelineUpdateLifecycleResult,
} from './TimelineUpdateLifecycle';

export interface TimelineLayoutOrchestratorParams {
  clips: CompositorClip[];
  timelineClips: any[];
  clipLayoutUpdater: TimelineClipLayoutUpdater;
  trackRebinder: TimelineTrackRebinder;
  updateLifecycle: TimelineUpdateLifecycle;
  getFallbackTrackId: (params: { clip: CompositorClip; next: any }) => string | null | undefined;
  getTrackRuntimeForClip: (clip: CompositorClip) => CompositorTrack | null;
  toVideoEffects: (value: unknown) => CompositorClip['effects'];
  applyClipLayoutForCurrentSource: (clip: CompositorClip) => void;
  clearClipTransitionFilter: (clip: CompositorClip) => void;
}

export class TimelineLayoutOrchestrator {
  public apply(params: TimelineLayoutOrchestratorParams): TimelineUpdateLifecycleResult {
    const byId = new Map<string, any>();
    for (const clipData of params.timelineClips) {
      if (clipData?.kind !== 'clip') {
        continue;
      }
      if (typeof clipData.id !== 'string' || clipData.id.length === 0) {
        continue;
      }
      byId.set(clipData.id, clipData);
    }

    for (const clip of params.clips) {
      const next = byId.get(clip.itemId);
      if (!next) {
        continue;
      }

      params.clipLayoutUpdater.update({
        clip,
        next,
        fallbackTrackId: params.getFallbackTrackId({ clip, next }),
        toVideoEffects: params.toVideoEffects,
        applyClipLayoutForCurrentSource: params.applyClipLayoutForCurrentSource,
        clearClipTransitionFilter: params.clearClipTransitionFilter,
      });
      params.trackRebinder.rebind({
        clip,
        trackRuntime: params.getTrackRuntimeForClip(clip),
      });
    }

    return params.updateLifecycle.apply(params.clips);
  }
}
