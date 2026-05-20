import type { Filter } from 'pixi.js';
import { safeDispose } from '../utils';
import {
  getTransitionManifest,
  normalizeTransitionParams,
  DEFAULT_TRANSITION_CURVE,
} from '~/transitions';
import type { CompositorClip } from './types';

export class TransitionManager {
  private transitionFilters = new Map<string, Filter>();

  public getActiveTransitionState(
    clip: CompositorClip,
    timeUs: number,
    previewEffectsEnabled: boolean,
  ) {
    const localTimeUs = timeUs - clip.startUs;

    let transition = clip.transitionIn;
    let edge: 'in' | 'out' = 'in';
    let progress = 0;

    if (
      transition &&
      transition.durationUs > 0 &&
      localTimeUs >= 0 &&
      localTimeUs < transition.durationUs
    ) {
      edge = 'in';
      progress = Math.max(0, Math.min(1, localTimeUs / transition.durationUs));
    } else {
      transition = clip.transitionOut;
      if (transition && transition.durationUs > 0) {
        const outStartUs = clip.durationUs - transition.durationUs;
        if (localTimeUs >= outStartUs && localTimeUs < clip.durationUs) {
          edge = 'out';
          progress = Math.max(0, Math.min(1, (localTimeUs - outStartUs) / transition.durationUs));
        } else {
          return null;
        }
      } else {
        return null;
      }
    }

    const manifest = previewEffectsEnabled ? getTransitionManifest(transition.type) : null;

    return {
      transition,
      manifest,
      progress,
      edge,
      curve: transition.curve ?? DEFAULT_TRANSITION_CURVE,
    };
  }

  public syncTransitionFilter(
    clip: CompositorClip,
    timeUs: number,
    previewEffectsEnabled: boolean,
  ) {
    if (!previewEffectsEnabled) {
      if (clip.transitionFilter) {
        try {
          clip.transitionFilter.destroy();
        } catch {
          // ignore
        }
        this.transitionFilters.delete(clip.itemId);
        clip.transitionFilter = null;
        clip.transitionFilterType = null;
      }
      if (clip.transitionSprite) {
        clip.transitionSprite.visible = false;
        clip.transitionSprite.filters = null;
      }
      return;
    }

    const state = this.getActiveTransitionState(clip, timeUs, previewEffectsEnabled);
    if (!state || state.manifest?.renderMode !== 'shader' || !state.manifest.createFilter) {
      if (clip.transitionFilter) {
        try {
          clip.transitionFilter.destroy();
        } catch {
          // ignore
        }
        this.transitionFilters.delete(clip.itemId);
        clip.transitionFilter = null;
        clip.transitionFilterType = null;
      }
      if (clip.transitionSprite) {
        clip.transitionSprite.visible = false;
        clip.transitionSprite.filters = null;
      }
      return;
    }

    let filter = clip.transitionFilter ?? this.transitionFilters.get(clip.itemId) ?? null;
    const nextFilterType = state.transition.type;
    if (filter && clip.transitionFilterType !== nextFilterType) {
      try {
        filter.destroy();
      } catch {
        // ignore
      }
      this.transitionFilters.delete(clip.itemId);
      clip.transitionFilter = null;
      clip.transitionFilterType = null;
      filter = null;
    }
    if (!filter) {
      filter = state.manifest.createFilter();
      this.transitionFilters.set(clip.itemId, filter);
    }

    clip.transitionFilter = filter;
    clip.transitionFilterType = nextFilterType;
  }

  public computeTransitionOpacity(
    clip: CompositorClip,
    timeUs: number,
    previewEffectsEnabled: boolean,
  ): number {
    const baseOpacity = clip.opacity ?? 1;
    const localTimeUs = timeUs - clip.startUs;

    const inDurUs = clip.transitionIn?.durationUs ?? 0;
    const outDurUs = clip.transitionOut?.durationUs ?? 0;
    const outStartUs = clip.durationUs - outDurUs;

    const inActive = inDurUs > 0 && localTimeUs >= 0 && localTimeUs < inDurUs;
    const outActive = outDurUs > 0 && localTimeUs >= outStartUs && localTimeUs < clip.durationUs;

    // If a clip is shorter than transitionIn + transitionOut, both windows
    // overlap. Picking the nearer edge keeps the curve monotonic; multiplying
    // both produced a black hole in the middle of short clips.
    let applyIn = inActive;
    let applyOut = outActive;
    if (inActive && outActive) {
      const distToInEnd = inDurUs - localTimeUs;
      const distToOutStart = localTimeUs - outStartUs;
      if (distToInEnd <= distToOutStart) {
        applyOut = false;
      } else {
        applyIn = false;
      }
    }

    if (!previewEffectsEnabled) {
      let opacity = baseOpacity;

      if (applyIn) {
        const rawProgress = Math.max(0, Math.min(1, localTimeUs / inDurUs));
        opacity = Math.min(opacity, baseOpacity * rawProgress);
      }

      if (applyOut) {
        const rawProgress = Math.max(0, Math.min(1, (localTimeUs - outStartUs) / outDurUs));
        opacity = Math.min(opacity, baseOpacity * (1 - rawProgress));
      }

      return Math.max(0, Math.min(1, opacity));
    }

    let opacity = baseOpacity;

    if (applyIn && clip.transitionIn) {
      const curve = clip.transitionIn.curve ?? DEFAULT_TRANSITION_CURVE;
      const manifest = getTransitionManifest(clip.transitionIn.type);
      if (manifest && manifest.renderMode !== 'shader') {
        const rawProgress = Math.max(0, Math.min(1, localTimeUs / inDurUs));
        const params = normalizeTransitionParams(clip.transitionIn.type, clip.transitionIn.params);
        opacity = Math.min(
          opacity,
          baseOpacity *
            manifest.computeInOpacity(
              rawProgress,
              (params as Record<string, unknown>) ?? {},
              curve,
            ),
        );
      }
    }

    if (applyOut && clip.transitionOut) {
      const curve = clip.transitionOut.curve ?? DEFAULT_TRANSITION_CURVE;
      const manifest = getTransitionManifest(clip.transitionOut.type);
      if (manifest && manifest.renderMode !== 'shader') {
        const rawProgress = Math.max(0, Math.min(1, (localTimeUs - outStartUs) / outDurUs));
        const params = normalizeTransitionParams(
          clip.transitionOut.type,
          clip.transitionOut.params,
        );
        opacity = Math.min(
          opacity,
          baseOpacity *
            manifest.computeOutOpacity(
              rawProgress,
              (params as Record<string, unknown>) ?? {},
              curve,
            ),
        );
      }
    }

    return Math.max(0, Math.min(1, opacity));
  }

  public ensureUsableTransitionFilter(
    clip: CompositorClip,
    manifest: import('~/transitions/core/types').TransitionManifest,
  ): Filter | null {
    const currentFilter = clip.transitionFilter;
    if (this.isTransitionFilterUsable(currentFilter)) {
      return currentFilter;
    }
    return this.recreateTransitionFilter(clip, manifest);
  }

  private isTransitionFilterUsable(filter: Filter | null | undefined): filter is Filter {
    if (!filter) return false;
    const candidate = filter as { destroyed?: boolean; resources?: Record<string, unknown> };
    if (candidate.destroyed) return false;
    return candidate.resources != null && Object.keys(candidate.resources).length > 0;
  }

  private recreateTransitionFilter(
    clip: CompositorClip,
    manifest: import('~/transitions/core/types').TransitionManifest,
  ): Filter | null {
    if (clip.transitionFilter) {
      try {
        clip.transitionFilter.destroy();
      } catch {
        /* ignore */
      }
    }

    this.transitionFilters.delete(clip.itemId);
    clip.transitionFilter = null;

    if (typeof manifest?.createFilter !== 'function') {
      clip.transitionFilterType = null;
      return null;
    }

    try {
      const filter = manifest.createFilter();
      clip.transitionFilter = filter;
      clip.transitionFilterType = manifest.name;
      this.transitionFilters.set(clip.itemId, filter);
      return filter;
    } catch (error) {
      console.error('[TransitionManager] Failed to recreate transition filter', error);
      clip.transitionFilterType = null;
      return null;
    }
  }

  public updateTransitionFilterSafely(
    clip: CompositorClip,
    manifest: import('~/transitions/core/types').TransitionManifest,
    filter: Filter,
    context: unknown,
  ): Filter | null {
    const applyUpdate = (candidate: Filter) => {
      manifest.updateFilter?.(candidate, context);
      return candidate;
    };

    try {
      return applyUpdate(filter);
    } catch (error) {
      console.error('[TransitionManager] Failed to update transition filter', error);
    }

    const recreatedFilter = this.recreateTransitionFilter(clip, manifest);
    if (!recreatedFilter) {
      return null;
    }

    try {
      return applyUpdate(recreatedFilter);
    } catch (error) {
      console.error('[TransitionManager] Failed to update recreated transition filter', error);
      return null;
    }
  }

  public clear() {
    for (const filter of this.transitionFilters.values()) {
      try {
        filter.destroy();
      } catch {
        /* ignore */
      }
    }
    this.transitionFilters.clear();
  }

  public clearClipFilter(clip: CompositorClip) {
    if (clip.transitionFilter) {
      try {
        clip.transitionFilter.destroy();
      } catch {
        // ignore
      }
      this.transitionFilters.delete(clip.itemId);
      clip.transitionFilter = null;
      clip.transitionFilterType = null;
    }

    safeDispose(clip.transitionFromTexture);
    safeDispose(clip.transitionToTexture);
    safeDispose(clip.transitionOutputTexture);
    safeDispose(clip.transitionCombinedTexture);
    clip.transitionFromTexture = null;
    clip.transitionToTexture = null;
    clip.transitionOutputTexture = null;
    clip.transitionCombinedTexture = null;
  }
}
