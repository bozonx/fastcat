import { createDevLogger } from '~/utils/dev-logger';
import type { Filter } from 'pixi.js';
import { safeDispose } from '../utils';
import {
  getTransitionManifest,
  normalizeTransitionParams,
  DEFAULT_TRANSITION_CURVE,
} from '~/transitions';
import type { CompositorClip } from './types';
const log = createDevLogger('TransitionManager');

export class TransitionManager {
  private transitionFilters = new Map<string, Filter>();

  public getActiveTransitionState(
    clip: CompositorClip,
    timeTicks: number,
    previewEffectsEnabled: boolean,
  ) {
    const localTimeTicks = timeTicks - clip.startTicks;

    const inTransition = clip.transitionIn;
    const outTransition = clip.transitionOut;
    const inDurTicks = inTransition?.durationTicks ?? 0;
    const outDurTicks = outTransition?.durationTicks ?? 0;
    const outStartTicks = clip.durationTicks - outDurTicks;

    const inActive =
      !!inTransition && inDurTicks > 0 && localTimeTicks >= 0 && localTimeTicks < inDurTicks;
    const outActive =
      !!outTransition &&
      outDurTicks > 0 &&
      localTimeTicks >= outStartTicks &&
      localTimeTicks < clip.durationTicks;

    // On clips shorter than transitionIn + transitionOut both windows overlap.
    // Pick the nearer edge — the same rule computeTransitionOpacity uses — so the
    // two never disagree about which transition is active.
    let useIn = false;
    let useOut = false;
    if (inActive && outActive) {
      const distToInEnd = inDurTicks - localTimeTicks;
      const distToOutStart = localTimeTicks - outStartTicks;
      if (distToInEnd <= distToOutStart) useIn = true;
      else useOut = true;
    } else if (inActive) {
      useIn = true;
    } else if (outActive) {
      useOut = true;
    }

    let transition: typeof inTransition;
    let edge: 'in' | 'out';
    let progress: number;
    if (useIn && inTransition) {
      transition = inTransition;
      edge = 'in';
      progress = Math.max(0, Math.min(1, localTimeTicks / inDurTicks));
    } else if (useOut && outTransition) {
      transition = outTransition;
      edge = 'out';
      progress = Math.max(0, Math.min(1, (localTimeTicks - outStartTicks) / outDurTicks));
    } else {
      return null;
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
    timeTicks: number,
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

    const state = this.getActiveTransitionState(clip, timeTicks, previewEffectsEnabled);
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
    timeTicks: number,
    previewEffectsEnabled: boolean,
  ): number {
    // A keyframed opacity replaces the static value as the pre-transition base;
    // transition fades still multiply on top.
    const baseOpacity =
      clip.animatedOpacity !== undefined
        ? clip.animatedOpacity
        : clip.opacityActive !== false
          ? (clip.opacity ?? 1)
          : 1;
    const localTimeTicks = timeTicks - clip.startTicks;

    const inDurTicks = clip.transitionIn?.durationTicks ?? 0;
    const outDurTicks = clip.transitionOut?.durationTicks ?? 0;
    const outStartTicks = clip.durationTicks - outDurTicks;

    const inActive = inDurTicks > 0 && localTimeTicks >= 0 && localTimeTicks < inDurTicks;
    const outActive =
      outDurTicks > 0 && localTimeTicks >= outStartTicks && localTimeTicks < clip.durationTicks;

    // If a clip is shorter than transitionIn + transitionOut, both windows
    // overlap. Picking the nearer edge keeps the curve monotonic; multiplying
    // both produced a black hole in the middle of short clips.
    let applyIn = inActive;
    let applyOut = outActive;
    if (inActive && outActive) {
      const distToInEnd = inDurTicks - localTimeTicks;
      const distToOutStart = localTimeTicks - outStartTicks;
      if (distToInEnd <= distToOutStart) {
        applyOut = false;
      } else {
        applyIn = false;
      }
    }

    if (!previewEffectsEnabled) {
      let opacity = baseOpacity;

      if (applyIn) {
        const rawProgress = Math.max(0, Math.min(1, localTimeTicks / inDurTicks));
        opacity = Math.min(opacity, baseOpacity * rawProgress);
      }

      if (applyOut) {
        const rawProgress = Math.max(
          0,
          Math.min(1, (localTimeTicks - outStartTicks) / outDurTicks),
        );
        opacity = Math.min(opacity, baseOpacity * (1 - rawProgress));
      }

      return Math.max(0, Math.min(1, opacity));
    }

    let opacity = baseOpacity;

    if (applyIn && clip.transitionIn) {
      const curve = clip.transitionIn.curve ?? DEFAULT_TRANSITION_CURVE;
      const manifest = getTransitionManifest(clip.transitionIn.type);
      if (manifest && manifest.renderMode !== 'shader') {
        const rawProgress = Math.max(0, Math.min(1, localTimeTicks / inDurTicks));
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
        const rawProgress = Math.max(
          0,
          Math.min(1, (localTimeTicks - outStartTicks) / outDurTicks),
        );
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
    manifest: import('~/transitions/core/registry').TransitionManifest,
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
    manifest: import('~/transitions/core/registry').TransitionManifest,
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
      log.error('Failed to recreate transition filter', error);
      clip.transitionFilterType = null;
      return null;
    }
  }

  public updateTransitionFilterSafely(
    clip: CompositorClip,
    manifest: import('~/transitions/core/registry').TransitionManifest,
    filter: Filter,
    context: unknown,
  ): Filter | null {
    const applyUpdate = (candidate: Filter) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      manifest.updateFilter?.(candidate, context as any);
      return candidate;
    };

    try {
      return applyUpdate(filter);
    } catch (error) {
      log.error('Failed to update transition filter', error);
    }

    const recreatedFilter = this.recreateTransitionFilter(clip, manifest);
    if (!recreatedFilter) {
      return null;
    }

    try {
      return applyUpdate(recreatedFilter);
    } catch (error) {
      log.error('Failed to update recreated transition filter', error);
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
