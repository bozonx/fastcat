import type { CompositorClip, CompositorTrack } from './types';

export interface TimelineTrackRebinderParams {
  clip: CompositorClip;
  trackRuntime: CompositorTrack | null;
}

export class TimelineTrackRebinder {
  public rebind(params: TimelineTrackRebinderParams): void {
    const { clip, trackRuntime } = params;

    if (!trackRuntime) {
      return;
    }

    if (clip.sprite.parent !== trackRuntime.container) {
      trackRuntime.container.addChild(clip.sprite);
    }
  }
}
