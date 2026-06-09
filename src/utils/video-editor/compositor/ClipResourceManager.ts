import { createDevLogger } from '~/utils/dev-logger';
import type { Sprite } from 'pixi.js';
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
const log = createDevLogger('ClipResourceManager');

export type WebMonitorSyncMode = 'smooth' | 'balanced' | 'strict';

export interface ClipResourceManagerContext {
  width: number;
  height: number;
  resourceManager: ResourceManager;
  videoFrameCache: VideoFrameCache;
  canvasFallbackRenderer: CanvasFallbackRenderer;
  getLayoutApplier: () => LayoutApplier;
}

export class ClipResourceManager {
  private readonly inFlightSamples = new Map<string, Promise<unknown | null>>();

  constructor(private readonly context: ClipResourceManagerContext) {}

  public setSize(width: number, height: number) {
    this.context.width = width;
    this.context.height = height;
  }

  public ensureClipRenderTexture(texture: RenderTexture | null): RenderTexture {
    const valid =
      texture &&
      !(texture as { destroyed?: boolean }).destroyed &&
      typeof (texture as { uid?: number }).uid === 'number' &&
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
      !(texture as { destroyed?: boolean }).destroyed &&
      typeof (texture as { uid?: number }).uid === 'number' &&
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
      !(texture as { destroyed?: boolean }).destroyed &&
      typeof (texture as { uid?: number }).uid === 'number' &&
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
    monitorSyncMode?: WebMonitorSyncMode;
    abortSignal?: AbortSignal;
  }): Promise<unknown | null> {
    const { clip, sampleTimeS, abortSignal } = params;
    const frameIndex = computeFrameIndex(clip, sampleTimeS);
    const cacheKey = buildVideoFrameCacheKey(clip, frameIndex);

    const cached = this.context.videoFrameCache.get(cacheKey);
    if (cached) {
      return {
        toVideoFrame: () => {
          if ((cached.frame as { closed?: boolean }).closed) {
            throw new Error('Cached VideoFrame is closed');
          }
          return cached.frame.clone();
        },
      };
    }

    const inFlight = this.inFlightSamples.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const promise = this.fetchVideoSampleForClip(
      clip,
      sampleTimeS,
      params.monitorSyncMode,
      frameIndex,
      cacheKey,
      abortSignal,
    );
    this.inFlightSamples.set(cacheKey, promise);

    try {
      return await promise;
    } finally {
      this.inFlightSamples.delete(cacheKey);
    }
  }

  private async fetchVideoSampleForClip(
    clip: CompositorClip,
    sampleTimeS: number,
    monitorSyncMode: WebMonitorSyncMode | undefined,
    frameIndex: number,
    cacheKey: string,
    abortSignal?: AbortSignal,
  ): Promise<unknown | null> {
    let sample = await this.context.resourceManager.withVideoSampleSlot(
      () =>
        getVideoSampleWithZeroFallback(
          clip.sink as unknown as import('mediabunny').VideoSampleSink,
          sampleTimeS,
          clip.firstTimestampS,
        ),
      abortSignal,
    );
    let sampleValue = sample as unknown;

    const sampleObj = sampleValue as { toVideoFrame?: () => VideoFrame };
    if (!sampleValue || typeof sampleObj.toVideoFrame !== 'function') {
      // The decoder occasionally returns null for a midstream timestamp even
      // though neighbouring frames decode fine. Retry slightly earlier so the
      // clip shows the previous source frame instead of becoming invisible
      // (which would leak through as a one-frame flicker in the export).
      const fallbackTimeS = resolveMonitorSampleFallbackTimeS({
        sampleTimeS,
        frameRate: clip.frameRate,
        monitorSyncMode,
      });
      if (fallbackTimeS !== null) {
        const retry = await this.context.resourceManager.withVideoSampleSlot(
          () =>
            getVideoSampleWithZeroFallback(
              clip.sink as unknown as import('mediabunny').VideoSampleSink,
              fallbackTimeS,
              clip.firstTimestampS,
            ),
          abortSignal,
        );
        const retryObj = retry as { toVideoFrame?: () => VideoFrame } | null;
        if (retry && typeof retryObj?.toVideoFrame === 'function') {
          sample = retry;
          sampleValue = retry as unknown;
        }
      }
    }

    const sampleObj2 = sampleValue as { toVideoFrame?: () => VideoFrame };
    if (!sampleValue || typeof sampleObj2.toVideoFrame !== 'function') {
      return sample;
    }

    try {
      const frame = sampleObj2.toVideoFrame() as VideoFrame;
      const width = Math.max(
        1,
        Math.round(
          Number(
            (frame as { codedWidth?: unknown }).codedWidth ??
              (frame as { displayWidth?: unknown }).displayWidth,
          ) || 1,
        ),
      );
      const height = Math.max(
        1,
        Math.round(
          Number(
            (frame as { codedHeight?: unknown }).codedHeight ??
              (frame as { displayHeight?: unknown }).displayHeight,
          ) || 1,
        ),
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
        toVideoFrame: () => {
          if ((frame as { closed?: boolean }).closed) {
            throw new Error('VideoFrame is closed');
          }
          return frame.clone();
        },
      };
    } finally {
      const closer = sampleValue as { close?: () => void };
      if (typeof closer?.close === 'function') {
        try {
          closer.close();
        } catch {
          // ignore
        }
      }
    }
  }

  public async updateClipTextureFromSample(sample: unknown, clip: CompositorClip) {
    try {
      const sampleObj = sample as { toVideoFrame?: () => VideoFrame };
      if (typeof sampleObj?.toVideoFrame === 'function') {
        if (clip.lastVideoFrame) {
          safeDispose(clip.lastVideoFrame);
          clip.lastVideoFrame = null;
        }

        const frame = sampleObj.toVideoFrame() as VideoFrame;

        try {
          const frameW = Math.max(
            1,
            Math.round(
              Number(
                (frame as { codedWidth?: unknown }).codedWidth ??
                  (frame as { displayWidth?: unknown }).displayWidth ??
                  1,
              ),
            ),
          );
          const frameH = Math.max(
            1,
            Math.round(
              Number(
                (frame as { codedHeight?: unknown }).codedHeight ??
                  (frame as { displayHeight?: unknown }).displayHeight ??
                  1,
              ),
            ),
          );

          if (clip.sourceKind !== 'videoFrame' && clip.sprite) {
            (clip.sprite as Sprite).texture.source = clip.imageSource;
            (clip as { sourceKind: CompositorClip['sourceKind'] }).sourceKind = 'videoFrame';
          }

          if (clip.imageSource.width !== frameW || clip.imageSource.height !== frameH) {
            clip.imageSource.resize(frameW, frameH);
          }

          (clip.imageSource as { resource?: unknown }).resource = frame as unknown;
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
      log.warn('[VideoCompositor] VideoFrame path failed, falling back to canvas:', err);
    }

    await this.context.canvasFallbackRenderer.drawSampleToCanvas(sample, clip);
  }

  public destroyClip(clip: CompositorClip, deps: { transitionManager: TransitionManager }) {
    for (const key of this.inFlightSamples.keys()) {
      if (key.startsWith(`${clip.itemId}:`)) {
        this.inFlightSamples.delete(key);
      }
    }

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
          (filter as { destroy?: () => void })?.destroy?.();
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
      clip.cropMaskKey = undefined;
    }
    if (clip.adjustmentSourceTexture) {
      try {
        clip.adjustmentSourceTexture.destroy(true);
      } catch {
        // ignore
      }
      clip.adjustmentSourceTexture = null;
    }
    if (clip.sprite) {
      clip.sprite.destroy(true);
      clip.sprite = null;
    }
  }
}

export function resolveMonitorSampleFallbackTimeS(params: {
  sampleTimeS: number;
  frameRate?: number;
  monitorSyncMode?: WebMonitorSyncMode;
}): number | null {
  const sampleTimeS = Number.isFinite(params.sampleTimeS) ? Math.max(0, params.sampleTimeS) : 0;
  const mode = params.monitorSyncMode ?? 'balanced';
  if (mode === 'strict') {
    return null;
  }

  const frameRate = Number(params.frameRate);
  const frameStepS = Number.isFinite(frameRate) && frameRate > 0 ? 1 / frameRate : 1 / 30;
  const fallbackFrames = mode === 'smooth' ? 2 : 0.5;
  const fallbackTimeS = Math.max(0, sampleTimeS - frameStepS * fallbackFrames);
  return fallbackTimeS < sampleTimeS ? fallbackTimeS : null;
}
