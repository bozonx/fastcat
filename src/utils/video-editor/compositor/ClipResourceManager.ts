import { RenderTexture } from 'pixi.js';
import { safeDispose } from '../utils';
import type { LayoutApplier } from './LayoutApplier';
import type { TransitionManager } from './TransitionManager';
import type { CompositorClip } from './types';
import type { ResourceManager } from './ResourceManager';
import { getVideoSampleWithZeroFallback } from './ResourceManager';
import type { VideoFrameCache } from './VideoFrameCache';
import {
  buildVideoFrameCacheKey,
  computeFrameIndex,
  estimateVideoFrameSizeBytes,
} from './VideoFrameCache';
import type { CanvasFallbackRenderer } from './renderers/CanvasFallbackRenderer';

export interface ClipResourceManagerContext {
  width: number;
  height: number;
  resourceManager: ResourceManager;
  videoFrameCache: VideoFrameCache;
  canvasFallbackRenderer: CanvasFallbackRenderer;
  getLayoutApplier: () => LayoutApplier;
}

export class ClipResourceManager {
  constructor(private readonly context: ClipResourceManagerContext) {}

  public setSize(width: number, height: number) {
    this.context.width = width;
    this.context.height = height;
  }

  public ensureClipRenderTexture(texture: RenderTexture | null): RenderTexture {
    const valid =
      texture &&
      !(texture as any).destroyed &&
      typeof (texture as any).uid === 'number' &&
      texture.width === this.context.width &&
      texture.height === this.context.height;

    if (valid) {
      return texture as RenderTexture;
    }

    if (texture) {
      try {
        safeDispose(texture);
      } catch {
        // ignore
      }
    }

    return RenderTexture.create({
      width: this.context.width,
      height: this.context.height,
    });
  }

  public ensureTransitionRenderTexture(texture: RenderTexture | null): RenderTexture {
    const valid =
      texture &&
      !(texture as any).destroyed &&
      typeof (texture as any).uid === 'number' &&
      texture.width === this.context.width &&
      texture.height === this.context.height;

    if (valid) {
      return texture as RenderTexture;
    }

    if (texture) {
      try {
        safeDispose(texture);
      } catch {
        // ignore
      }
    }

    return RenderTexture.create({
      width: this.context.width,
      height: this.context.height,
    });
  }

  public ensureCombinedTransitionTexture(texture: RenderTexture | null): RenderTexture {
    const valid =
      texture &&
      !(texture as any).destroyed &&
      typeof (texture as any).uid === 'number' &&
      texture.width === this.context.width * 2 &&
      texture.height === this.context.height;

    if (valid) {
      return texture as RenderTexture;
    }

    if (texture) {
      try {
        safeDispose(texture);
      } catch {
        // ignore
      }
    }

    return RenderTexture.create({
      width: this.context.width * 2,
      height: this.context.height,
    });
  }

  public async getVideoSampleForClip(params: {
    clip: CompositorClip;
    sampleTimeS: number;
    abortSignal?: AbortSignal;
  }): Promise<any | null> {
    const { clip, sampleTimeS, abortSignal } = params;
    const frameIndex = computeFrameIndex(clip, sampleTimeS);
    const cacheKey = buildVideoFrameCacheKey(clip, frameIndex);
    const cached = this.context.videoFrameCache.get(cacheKey);
    if (cached) {
      return {
        toVideoFrame: () => cached.frame.clone(),
      };
    }

    const sample = await this.context.resourceManager.withVideoSampleSlot(
      () => getVideoSampleWithZeroFallback(clip.sink as any, sampleTimeS, clip.firstTimestampS),
      abortSignal,
    );
    const sampleValue = sample as any;

    if (!sampleValue || typeof sampleValue.toVideoFrame !== 'function') {
      return sample;
    }

    try {
      const frame = sampleValue.toVideoFrame() as VideoFrame;
      const width = Math.max(
        1,
        Math.round(Number((frame as any).displayWidth ?? (frame as any).codedWidth) || 1),
      );
      const height = Math.max(
        1,
        Math.round(Number((frame as any).displayHeight ?? (frame as any).codedHeight) || 1),
      );
      const sizeBytes = estimateVideoFrameSizeBytes(frame, width, height);

      this.context.videoFrameCache.set({
        key: cacheKey,
        clipId: clip.itemId,
        frameIndex,
        frame,
        sizeBytes,
        width,
        height,
      });

      return {
        toVideoFrame: () => frame.clone(),
      };
    } finally {
      if (typeof sampleValue?.close === 'function') {
        try {
          sampleValue.close();
        } catch {
          // ignore
        }
      }
    }
  }

  public async updateClipTextureFromSample(sample: any, clip: CompositorClip) {
    try {
      if (typeof sample?.toVideoFrame === 'function') {
        if (clip.lastVideoFrame) {
          safeDispose(clip.lastVideoFrame);
          clip.lastVideoFrame = null;
        }

        const frame = sample.toVideoFrame() as VideoFrame;

        try {
          const frameW = Math.max(
            1,
            Math.round((frame as any).displayWidth ?? (frame as any).codedWidth ?? 1),
          );
          const frameH = Math.max(
            1,
            Math.round((frame as any).displayHeight ?? (frame as any).codedHeight ?? 1),
          );

          if (clip.sourceKind !== 'videoFrame') {
            clip.sprite.texture.source = clip.imageSource as any;
            clip.sourceKind = 'videoFrame';
          }

          if (clip.imageSource.width !== frameW || clip.imageSource.height !== frameH) {
            clip.imageSource.resize(frameW, frameH);
          }

          (clip.imageSource as any).resource = frame as any;
          clip.imageSource.update();
          clip.lastVideoFrame = frame;

          this.context.getLayoutApplier().applySpriteLayout(frameW, frameH, clip);

          return;
        } catch (error) {
          safeDispose(frame);
          throw error;
        }
      }
    } catch (err) {
      console.warn('[VideoCompositor] VideoFrame path failed, falling back to canvas:', err);
    }

    await this.context.canvasFallbackRenderer.drawSampleToCanvas(sample, clip);
  }

  public destroyClip(clip: CompositorClip, deps: { transitionManager: TransitionManager }) {
    this.context.videoFrameCache.clearForClip(clip.itemId);
    safeDispose(clip.sink);
    safeDispose(clip.input);
    if (clip.lastVideoFrame) {
      safeDispose(clip.lastVideoFrame);
      clip.lastVideoFrame = null;
    }

    if (clip.bitmap) {
      safeDispose(clip.bitmap);
      clip.bitmap = null;
    }

    if (clip.hudMediaStates) {
      const bgs = clip.hudMediaStates.background;
      if (bgs) {
        this.context.videoFrameCache.clearForClip(clip.itemId + '_bg');
        safeDispose(bgs.sink);
        safeDispose(bgs.input);
        if (bgs.lastVideoFrame) safeDispose(bgs.lastVideoFrame);
        if (bgs.bitmap) safeDispose(bgs.bitmap);
        if (bgs.sprite) bgs.sprite.destroy(true);
      }
      const cts = clip.hudMediaStates.content;
      if (cts) {
        this.context.videoFrameCache.clearForClip(clip.itemId + '_ct');
        safeDispose(cts.sink);
        safeDispose(cts.input);
        if (cts.lastVideoFrame) safeDispose(cts.lastVideoFrame);
        if (cts.bitmap) safeDispose(cts.bitmap);
        if (cts.sprite) cts.sprite.destroy(true);
      }
      const frs = clip.hudMediaStates.frame;
      if (frs) {
        this.context.videoFrameCache.clearForClip(clip.itemId + '_fr');
        safeDispose(frs.sink);
        safeDispose(frs.input);
        if (frs.lastVideoFrame) safeDispose(frs.lastVideoFrame);
        if (frs.bitmap) safeDispose(frs.bitmap);
        if (frs.sprite) frs.sprite.destroy(true);
      }
      clip.hudMediaStates = {};
    }

    if (clip.maskState) {
      this.context.videoFrameCache.clearForClip(clip.itemId + '_mask');
      safeDispose(clip.maskState.sink);
      safeDispose(clip.maskState.input);
      if (clip.maskState.lastVideoFrame) safeDispose(clip.maskState.lastVideoFrame);
      if (clip.maskState.bitmap) safeDispose(clip.maskState.bitmap);
      if (clip.maskState.sprite) clip.maskState.sprite.destroy(true);
      clip.maskState = null;
    }

    if (clip.sprite && clip.sprite.parent) {
      clip.sprite.parent.removeChild(clip.sprite);
    }
    if (clip.transitionSprite && clip.transitionSprite.parent) {
      clip.transitionSprite.parent.removeChild(clip.transitionSprite);
    }

    if (clip.effectFilters) {
      for (const filter of clip.effectFilters.values()) {
        try {
          (filter as any)?.destroy?.();
        } catch {
          // ignore
        }
      }
      clip.effectFilters.clear();
    }
    deps.transitionManager.clearClipFilter(clip);
    if (clip.transitionFromTexture) {
      safeDispose(clip.transitionFromTexture);
      clip.transitionFromTexture = null;
    }
    if (clip.transitionToTexture) {
      safeDispose(clip.transitionToTexture);
      clip.transitionToTexture = null;
    }
    if (clip.transitionOutputTexture) {
      safeDispose(clip.transitionOutputTexture);
      clip.transitionOutputTexture = null;
    }
    if (clip.transitionCombinedTexture) {
      safeDispose(clip.transitionCombinedTexture);
      clip.transitionCombinedTexture = null;
    }
    if (clip.transitionSprite) {
      clip.transitionSprite.destroy(true);
      clip.transitionSprite = null;
    }
    if (clip.cropMask) {
      clip.cropMask.destroy(true);
      clip.cropMask = undefined;
    }
    if (clip.sprite) {
      clip.sprite.destroy(true);
      clip.sprite = null;
    }
  }
}
