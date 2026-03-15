import type { Application } from 'pixi.js';
import type { CompositorClip, CompositorTrack } from './types';

export interface StageManagerParams {
  app: Application;
  tracks: CompositorTrack[];
  getClipById: (clipId: string) => CompositorClip | undefined;
  getTrackById: (trackId: string) => CompositorTrack | undefined;
}

export class StageManager {
  public sortStage(params: StageManagerParams) {
    this.sortTrackContainerChildren(params.tracks, params.getClipById);
    params.app.stage.children.sort((a: any, b: any) => {
      const aTrack = params.getTrackById((a as any).__trackId ?? '');
      const bTrack = params.getTrackById((b as any).__trackId ?? '');
      const aLayer = typeof aTrack?.layer === 'number' ? aTrack.layer : 0;
      const bLayer = typeof bTrack?.layer === 'number' ? bTrack.layer : 0;
      return aLayer - bLayer;
    });
  }

  private sortTrackContainerChildren(
    tracks: CompositorTrack[],
    getClipById: (clipId: string) => CompositorClip | undefined,
  ) {
    for (const track of tracks) {
      track.container.children.sort((a: any, b: any) => {
        const aClip = getClipById((a as any)?.__clipId ?? '');
        const bClip = getClipById((b as any)?.__clipId ?? '');

        const aStartUs = aClip?.startUs ?? 0;
        const bStartUs = bClip?.startUs ?? 0;
        if (aStartUs !== bStartUs) {
          return aStartUs - bStartUs;
        }

        const aEndUs = aClip?.endUs ?? 0;
        const bEndUs = bClip?.endUs ?? 0;
        if (aEndUs !== bEndUs) {
          return aEndUs - bEndUs;
        }

        const aOrder = typeof (a as any)?.__clipOrder === 'number' ? (a as any).__clipOrder : 0;
        const bOrder = typeof (b as any)?.__clipOrder === 'number' ? (b as any).__clipOrder : 0;
        if (aOrder !== bOrder) {
          return aOrder - bOrder;
        }

        return String((a as any)?.__clipId ?? '').localeCompare(String((b as any)?.__clipId ?? ''));
      });
    }
  }
}
