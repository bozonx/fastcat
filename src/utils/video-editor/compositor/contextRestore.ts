import { Texture } from 'pixi.js';
import { safeDispose } from '../utils';
import type { CompositorClip } from './types';

export function resetCompositorClipsAfterContextRestored(clips: CompositorClip[]): void {
  for (const clip of clips) {
    clip.textDirty = true;
    clip.shapeDirty = true;
    clip.nonVideoEffectCacheKey = undefined;

    if (clip.lastVideoFrame) {
      safeDispose(clip.lastVideoFrame);
      clip.lastVideoFrame = null;
    }

    resetHudMediaStates(clip);
    resetBitmapState(clip);
    refreshImageSource(clip);
    resetTransitionState(clip);
    resetAdjustmentState(clip);
  }
}

function resetHudMediaStates(clip: CompositorClip): void {
  if (!clip.hudMediaStates) {
    return;
  }

  resetHudMediaState(clip.hudMediaStates.background);
  resetHudMediaState(clip.hudMediaStates.content);
  resetHudMediaState(clip.hudMediaStates.frame);
  clip.hudDirty = true;
}

function resetHudMediaState(value: unknown): void {
  if (!value) return;

  const state = value as Record<string, unknown>;
  if (state.lastVideoFrame) {
    safeDispose(state.lastVideoFrame as VideoFrame | ImageBitmap | null);
    state.lastVideoFrame = null;
  }

  if (state.bitmap) {
    try {
      (state.bitmap as { close: () => void }).close();
    } catch {
      // no-op
    }
    state.bitmap = null;
  }
}

function resetBitmapState(clip: CompositorClip): void {
  clip.canvas = null;

  if (clip.bitmap) {
    try {
      clip.bitmap.close();
    } catch {
      // no-op
    }
    clip.bitmap = null;
  }

  if (clip.sprite && !clip.sprite.destroyed && clip.sprite.texture !== Texture.EMPTY) {
    try {
      clip.sprite.texture = Texture.EMPTY;
    } catch {
      // no-op
    }
  }
}

function refreshImageSource(clip: CompositorClip): void {
  try {
    if (
      clip.imageSource?.resource &&
      typeof (clip.imageSource.resource as { update?: () => void }).update === 'function'
    ) {
      (clip.imageSource.resource as { update?: () => void }).update?.();
    }
  } catch {
    // no-op
  }
}

function resetTransitionState(clip: CompositorClip): void {
  if (!clip.transitionFilter) {
    return;
  }

  try {
    clip.transitionFilter.destroy();
  } catch {
    // no-op
  }
  clip.transitionFilter = null;
}

function resetAdjustmentState(clip: CompositorClip): void {
  if (!clip.adjustmentSourceTexture) {
    return;
  }

  try {
    clip.adjustmentSourceTexture.destroy(true);
  } catch {
    // no-op
  }
  clip.adjustmentSourceTexture = null;
}
