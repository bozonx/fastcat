import type { Filter, Container, TextureSource } from 'pixi.js';
import type { VideoClipEffect } from '~/timeline/types';
import type { CompositorClip, CompositorTrack } from './types';
import { ClipMaskFilter } from './filters/ClipMaskFilter';

export interface EffectManagerContext {
  previewEffectsEnabled: boolean;
}

export class EffectManager {
  /**
   * Applies effects to a clip's sprite.
   */
  public applyClipEffects(clip: CompositorClip, context: EffectManagerContext) {
    if (!clip.effectFilters) {
      clip.effectFilters = new Map();
    }

    if (!clip.sprite) {
      return;
    }

    const maskFilter = this.syncMaskFilter(clip);

    if (!context.previewEffectsEnabled) {
      clip.sprite.filters = maskFilter ? [maskFilter] : null;
      return;
    }

    const filters = this.syncFilters(clip.effectFilters, clip.effects ?? []);
    if (maskFilter) {
      filters.push(maskFilter);
    }

    clip.sprite.filters = filters.length > 0 ? filters : null;
  }

  private syncMaskFilter(clip: CompositorClip): ClipMaskFilter | null {
    if (clip.maskActive === false || !clip.mask || !clip.maskState) {
      // Remove mask filter if it exists
      if (clip.effectFilters?.has('__mask')) {
        const filter = clip.effectFilters.get('__mask');
        clip.effectFilters.delete('__mask');
        try {
          (filter as { destroy?: () => void })?.destroy?.();
        } catch {
          /* no-op */
        }
      }
      return null;
    }

    let filter = clip.effectFilters?.get('__mask') as ClipMaskFilter | undefined;

    const maskSource = this.resolveMaskSource(clip);

    // No fresh mask source this round (e.g., a video mask whose lastVideoFrame
    // was disposed at end of the previous frame). Skip applying the filter
    // instead of returning a cached filter that still points at a closed
    // VideoFrame — the cached filter will be reused as soon as a frame arrives.
    if (!maskSource) return null;

    if (!filter) {
      filter = new ClipMaskFilter({
        uMask: maskSource,
        uMode: clip.mask.mode === 'luma' ? 1.0 : 0.0,
        uInvert: !!clip.mask.invert,
      });
      clip.effectFilters?.set('__mask', filter);
    } else {
      filter.uMask = maskSource;
      filter.uMode = clip.mask.mode === 'luma' ? 1.0 : 0.0;
      filter.uInvert = !!clip.mask.invert;
    }

    return filter;
  }

  private resolveMaskSource(clip: CompositorClip): TextureSource | null {
    const maskState = clip.maskState;
    if (!maskState?.imageSource) {
      return null;
    }

    if (maskState.clipKind === 'video') {
      const frame = maskState.lastVideoFrame;
      if (!frame) {
        return null;
      }

      const frameWidth = Math.max(
        1,
        Math.round(
          Number(
            (frame as { displayWidth?: number; codedWidth?: number }).displayWidth ??
              (frame as { displayWidth?: number; codedWidth?: number }).codedWidth ??
              1,
          ),
        ),
      );
      const frameHeight = Math.max(
        1,
        Math.round(
          Number(
            (frame as { displayHeight?: number; codedHeight?: number }).displayHeight ??
              (frame as { displayHeight?: number; codedHeight?: number }).codedHeight ??
              1,
          ),
        ),
      );

      if (
        maskState.imageSource.width !== frameWidth ||
        maskState.imageSource.height !== frameHeight
      ) {
        maskState.imageSource.resize(frameWidth, frameHeight);
      }

      (maskState.imageSource as { resource?: unknown }).resource = frame as unknown;
      maskState.imageSource.update();
    }

    return maskState.imageSource;
  }

  /**
   * Applies effects to a track's container.
   */
  public applyTrackEffects(track: CompositorTrack, context: EffectManagerContext) {
    if (!track.effectFilters) {
      track.effectFilters = new Map();
    }

    if (!track.container) {
      return;
    }

    if (!context.previewEffectsEnabled) {
      track.container.filters = null;
      return;
    }

    const filters = this.syncFilters(track.effectFilters, track.effects ?? []);
    track.container.filters = filters.length > 0 ? filters : null;
  }

  /**
   * Applies effects to the master stage (or any container).
   */
  public applyMasterEffects(
    container: Container,
    effects: VideoClipEffect[] | null,
    filtersMap: Map<string, Filter>,
    context: EffectManagerContext,
  ) {
    if (!container) {
      return;
    }

    if (!context.previewEffectsEnabled) {
      container.filters = null;
      return;
    }

    const filters = this.syncFilters(filtersMap, effects ?? []);
    container.filters = filters.length > 0 ? filters : null;
  }

  /**
   * Video-effect math now lives in the shared WGSL compute runner, not in
   * per-effect Pixi filters. No manifest produces Pixi filters anymore, so this
   * only tears down any filters left over from the previous architecture and
   * returns none. The WebGPU compute runner integration replaces this path.
   */
  private syncFilters(filtersMap: Map<string, Filter>, _effects: VideoClipEffect[]): Filter[] {
    if (!filtersMap) return [];

    for (const [id, filter] of filtersMap.entries()) {
      filtersMap.delete(id);
      try {
        (filter as { destroy?: () => void })?.destroy?.();
      } catch {
        // ignore
      }
    }

    return [];
  }
}
