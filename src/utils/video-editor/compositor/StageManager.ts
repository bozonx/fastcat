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
    params.app.stage.children.sort(
      (a: any, b: any) => {
        const aTrackId = String((a as { __trackId?: string }).__trackId ?? '');
        const bTrackId = String((b as { __trackId?: string }).__trackId ?? '');
        const aTrack = params.getTrackById(aTrackId);
        const bTrack = params.getTrackById(bTrackId);
        const aLayer = typeof aTrack?.layer === 'number' ? aTrack.layer : 0;
        const bLayer = typeof bTrack?.layer === 'number' ? bTrack.layer : 0;
        if (aLayer !== bLayer) return aLayer - bLayer;
        return aTrackId.localeCompare(bTrackId);
      },
    );
  }

  private sortTrackContainerChildren(
    tracks: CompositorTrack[],
    getClipById: (clipId: string) => CompositorClip | undefined,
  ) {
    for (const track of tracks) {
      track.container.children.sort(
        (a: any, b: any) => {
          const aClip = getClipById((a as { __clipId?: string }).__clipId ?? '');
          const bClip = getClipById((b as { __clipId?: string }).__clipId ?? '');

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

          const aOrder =
            typeof (a as { __clipOrder?: number }).__clipOrder === 'number'
              ? (a as { __clipOrder?: number }).__clipOrder
              : 0;
          const bOrder =
            typeof (b as { __clipOrder?: number }).__clipOrder === 'number'
              ? (b as { __clipOrder?: number }).__clipOrder
              : 0;
          if (aOrder !== bOrder) {
            return (aOrder ?? 0) - (bOrder ?? 0);
          }

          return String((a as { __clipId?: string }).__clipId ?? '').localeCompare(
            String((b as { __clipId?: string }).__clipId ?? ''),
          );
        },
      );
    }
  }
}
