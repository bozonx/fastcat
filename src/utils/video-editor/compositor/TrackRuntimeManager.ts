import { Container, type Application } from 'pixi.js';
import type { VideoClipEffect } from '~/timeline/types';
import { toPixiBlendMode, type CompositorClip, type CompositorTrack } from './types';
import { buildTrackRuntimeList } from './trackRuntime';

export interface TrackRuntimeManagerParams {
  toVideoEffects: (value: unknown) => VideoClipEffect[] | undefined;
}

export class TrackRuntimeManager {
  private trackById = new Map<string, CompositorTrack>();
  private trackByLayer = new Map<number, CompositorTrack>();
  private tracks: CompositorTrack[] = [];

  constructor(private readonly params: TrackRuntimeManagerParams) {}

  public get all(): CompositorTrack[] {
    return this.tracks;
  }

  public get byId(): Map<string, CompositorTrack> {
    return this.trackById;
  }

  public setById(trackById: Map<string, CompositorTrack>) {
    this.trackById = trackById;
    this.trackByLayer = new Map([...trackById.values()].map((track) => [track.layer, track]));
    this.tracks = [...trackById.values()].sort((a, b) => a.layer - b.layer);
  }

  public setAll(tracks: CompositorTrack[]) {
    this.tracks = tracks;
    this.trackById = new Map(tracks.map((track) => [track.id, track]));
    this.trackByLayer = new Map(tracks.map((track) => [track.layer, track]));
  }

  public getById(trackId: string): CompositorTrack | undefined {
    return this.trackById.get(trackId);
  }

  public getForClip(clip: Pick<CompositorClip, 'trackId' | 'layer'>): CompositorTrack | null {
    if (clip.trackId) {
      return this.trackById.get(clip.trackId) ?? this.trackByLayer.get(clip.layer) ?? null;
    }
    return this.trackByLayer.get(clip.layer) ?? null;
  }

  public buildList(timelineItems: ReadonlyArray<unknown>) {
    return buildTrackRuntimeList(timelineItems, this.params.toVideoEffects);
  }

  public sync(timelineItems: ReadonlyArray<unknown>, app: Application | null) {
    if (!app) return;

    const nextDefs = this.buildList(timelineItems);
    const nextTrackById = new Map<string, CompositorTrack>();
    const nextTrackByLayer = new Map<number, CompositorTrack>();
    const nextTracks: CompositorTrack[] = [];

    for (const def of nextDefs) {
      const existing = this.trackById.get(def.id) ?? this.trackByLayer.get(def.layer);
      const track: CompositorTrack = existing ?? {
        id: def.id,
        layer: def.layer,
        container: new Container(),
      };

      track.id = def.id;
      track.layer = def.layer;
      track.opacity = def.opacity;
      track.blendMode = def.blendMode;
      track.effects = def.effects;
      track.container.alpha = def.opacity ?? 1;
      track.container.blendMode = toPixiBlendMode(def.blendMode);
      (track.container as unknown as Record<string, unknown>).__trackId = def.id;

      if (track.container.parent !== app.stage) {
        app.stage.addChild(track.container);
      }

      nextTrackById.set(track.id, track);
      nextTrackByLayer.set(track.layer, track);
      nextTracks.push(track);
    }

    for (const [trackId, track] of this.trackById.entries()) {
      if (nextTrackById.has(trackId)) continue;
      this.disposeTrack(track);
    }

    this.trackById = nextTrackById;
    this.trackByLayer = nextTrackByLayer;
    this.tracks = nextTracks.sort((a, b) => a.layer - b.layer);
  }

  public clear() {
    for (const track of this.tracks) {
      this.disposeTrack(track, true);
    }
    this.trackById.clear();
    this.trackByLayer.clear();
    this.tracks = [];
  }

  private disposeTrack(track: CompositorTrack, destroyContainer = false) {
    if (track.effectFilters) {
      for (const filter of track.effectFilters.values()) {
        try {
          (filter as { destroy?: () => void })?.destroy?.();
        } catch {
          // ignore
        }
      }
      track.effectFilters.clear();
    }

    track.container.filters = null;
    if (track.container.parent) {
      track.container.parent.removeChild(track.container);
    }
    track.container.removeChildren();
    if (destroyContainer) {
      track.container.destroy({ children: false });
    }
  }
}
