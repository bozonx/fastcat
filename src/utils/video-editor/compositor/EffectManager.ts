import type { Filter, Container } from 'pixi.js';
import { getVideoEffectManifest } from '../../../effects';
import type { VideoClipEffect } from '~/timeline/types';
import type { CompositorClip, CompositorTrack } from './types';
import { ClipMaskFilter } from './filters/ClipMaskFilter';
import { Texture } from 'pixi.js';

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

    if (!context.previewEffectsEnabled) {
      clip.sprite.filters = null;
      return;
    }

    const filters = this.syncFilters(clip.effectFilters, clip.effects ?? []);
    
    // Add mask filter if present
    const maskFilter = this.syncMaskFilter(clip);
    if (maskFilter) {
      filters.push(maskFilter);
    }

    clip.sprite.filters = filters.length > 0 ? filters : null;
  }

  private syncMaskFilter(clip: CompositorClip): ClipMaskFilter | null {
    if (!clip.mask || !clip.maskState) {
      // Remove mask filter if it exists
      if (clip.effectFilters?.has('__mask')) {
        const filter = clip.effectFilters.get('__mask');
        clip.effectFilters.delete('__mask');
        try { (filter as any)?.destroy?.(); } catch {}
      }
      return null;
    }

    let filter = clip.effectFilters?.get('__mask') as ClipMaskFilter | undefined;
    
    // Update mask texture
    let maskTexture: Texture | null = null;
    if (clip.maskState.clipKind === 'video' && clip.maskState.lastVideoFrame) {
      maskTexture = new Texture({ source: clip.maskState.lastVideoFrame as any });
    } else if (clip.maskState.clipKind === 'image' && clip.maskState.bitmap) {
      maskTexture = new Texture({ source: clip.maskState.bitmap as any });
    }

    if (!maskTexture) return filter || null;

    if (!filter) {
      filter = new ClipMaskFilter({
        uMask: maskTexture,
        uMode: clip.mask.mode === 'luma' ? 1 : 0,
        uInvert: !!clip.mask.invert,
      });
      clip.effectFilters?.set('__mask', filter);
    } else {
      filter.uMask = maskTexture.source;
      filter.uMode = clip.mask.mode === 'luma' ? 1 : 0;
      filter.uInvert = !!clip.mask.invert;
    }

    return filter;
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
   * Universal filter synchronization logic.
   */
  private syncFilters(filtersMap: Map<string, Filter>, effects: VideoClipEffect[]): Filter[] {
    if (!filtersMap) return [];
    const filters: Filter[] = [];
    const seenIds = new Set<string>();

    for (const effect of effects) {
      if (!effect?.enabled) continue;
      if (typeof effect.id !== 'string' || effect.id.length === 0) continue;
      if (typeof effect.type !== 'string' || effect.type.length === 0) continue;

      const manifest = getVideoEffectManifest(effect.type);
      if (!manifest) continue;

      seenIds.add(effect.id);
      let filter = filtersMap.get(effect.id);
      if (!filter) {
        filter = manifest.createFilter();
        filtersMap.set(effect.id, filter);
      }

      try {
        manifest.updateFilter(filter, effect);
      } catch (err) {
        console.error('[EffectManager] Failed to update effect filter', err);
        continue;
      }

      filters.push(filter);
    }

    // Cleanup filters for removed effects
    for (const [id, filter] of filtersMap.entries()) {
      if (seenIds.has(id)) continue;
      filtersMap.delete(id);
      try {
        (filter as any)?.destroy?.();
      } catch {
        // ignore
      }
    }

    return filters;
  }
}
