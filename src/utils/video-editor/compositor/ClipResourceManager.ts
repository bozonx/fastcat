import { createDevLogger } from '~/utils/dev-logger';
import type { Application, Sprite } from 'pixi.js';
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
import type { WebGpuComputeRunner } from './WebGpuComputeRunner';
import { buildEffectSpecs } from '~/effects';
import { compositorPerfStats } from './CompositorPerfStats';
const log = createDevLogger('ClipResourceManager');

function fastHash(input: unknown): string {
  const str = typeof input === 'string' ? input : JSON.stringify(input);
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

export type WebMonitorSyncMode = 'smooth' | 'balanced' | 'strict';

export interface ClipResourceManagerContext {
  width: number;
  height: number;
  resourceManager: ResourceManager;
  videoFrameCache: VideoFrameCache;
  canvasFallbackRenderer: CanvasFallbackRenderer;
  getLayoutApplier: () => LayoutApplier;
  computeRunner?: WebGpuComputeRunner;
  getApp?: () => Application;
}

interface ClipWarmStream {
  iterator: AsyncGenerator<{
    timestamp: number;
    toVideoFrame?: () => VideoFrame;
    close?: () => void;
  } | null>;
  /** Source PTS (s) of the last consumed sample — the stream's warm frontier. */
  lastTimeS: number;
  /** Playhead source time (s) of the previous warm tick — for seek detection. */
  lastNowS: number;
  done: boolean;
}

export class ClipResourceManager {
  private readonly inFlightSamples = new Map<string, Promise<unknown | null>>();
  private readonly clipWarmStreams = new Map<string, ClipWarmStream>();

  constructor(private readonly context: ClipResourceManagerContext) {}

  public setSize(width: number, height: number) {
    this.context.width = width;
    this.context.height = height;
  }

  public getComputeRunner(): WebGpuComputeRunner | undefined {
    return this.context.computeRunner;
  }

  /**
   * Applies WebGPU compute effects to non-video clips (image, text, shape, solid).
   * Rasterises the clip source, runs the effect pipeline, and updates the sprite
   * texture with the processed result.
   *
   * Reuses `clip.imageSource` in-place (like the video path) instead of creating
   * a new `Texture.from()` every frame — the old approach orphaned a full-frame
   * GPU texture on every call (~8 MB/frame at 1080p).
   *
   * A cache key derived from the clip's effects and content skips reprocessing
   * when nothing has changed, avoiding per-frame WebGPU compute for static clips.
   */
  public async applyEffectsToNonVideoClip(
    clip: CompositorClip,
    previewEffectsEnabled: boolean,
  ): Promise<void> {
    if (!previewEffectsEnabled) return;
    const hasEffects = (clip.effects?.length ?? 0) > 0;
    const runner = this.context.computeRunner;
    if (!hasEffects || !runner?.isReady()) {
      // Clear stale stored dimensions so applyClipLayoutForCurrentSource
      // uses imageSource directly when effects are off/unavailable.
      clip.effectSourceW = undefined;
      clip.effectSourceH = undefined;
      clip.effectIgnoreTransform = undefined;
      return;
    }

    const effectSpecs = buildEffectSpecs(clip.effects);
    if (!effectSpecs || effectSpecs.length === 0) return;

    // Skip reprocessing when clip content and effects haven't changed.
    const cacheKey = this.buildNonVideoEffectCacheKey(clip, effectSpecs);
    if (cacheKey === clip.nonVideoEffectCacheKey && clip.lastVideoFrame) {
      return;
    }

    const sourceBitmap = await this.getNonVideoClipBitmap(clip);
    if (!sourceBitmap) return;

    // The unpadded source dimensions drive the layout for regular effects: the
    // blur "bleed" path pads the processed bitmap, so laying it out with the
    // padded size would shrink the visible content. `applySpriteLayout`
    // re-derives the padding from the texture-vs-frame size difference.
    const sourceW = sourceBitmap.width;
    const sourceH = sourceBitmap.height;

    // Follow the video-path pattern: save the previous processed frame for
    // disposal after the new one is committed, preventing GPU texture leaks.
    let prevProcessed: VideoFrame | ImageBitmap | null = clip.lastVideoFrame;
    try {
      const blurFillIndex = effectSpecs.findIndex((e) => e.type === 'blur-fill');
      let processed: ImageBitmap | null = null;

      if (blurFillIndex >= 0) {
        const blurFill = effectSpecs[
          blurFillIndex
        ] as import('~/types/generated/native-monitor/VideoEffectSpec').VideoEffectSpec & {
          type: 'blur-fill';
        };
        const otherSpecs = effectSpecs.filter((_, i) => i !== blurFillIndex);
        let source = sourceBitmap;
        if (otherSpecs.length > 0) {
          const p = await runner.applyEffects(source, otherSpecs);
          if (p) {
            if (source !== sourceBitmap) source.close();
            source = p;
          }
        }
        processed = await runner.applyBlurFill({
          source,
          frameW: this.context.width,
          frameH: this.context.height,
          fgScale: blurFill.fg_scale,
          bgScale: blurFill.bg_scale,
          blur: blurFill.blur,
          bgDim: blurFill.bg_dim,
          bgSaturation: blurFill.bg_saturation,
          tintColor: blurFill.tint_color,
          tintStrength: blurFill.tint_strength,
          fgOffsetY: blurFill.fg_offset_y,
        });
        if (source !== sourceBitmap) source.close();
      } else {
        processed = await runner.applyEffects(sourceBitmap, effectSpecs);
      }

      if (processed) {
        // Reuse the existing imageSource like the video path does, instead of
        // creating a new Texture.from(processed) which orphans the old GPU texture.
        if (clip.sprite && (clip.sprite as Sprite).texture.source !== clip.imageSource) {
          (clip.sprite as Sprite).texture.source = clip.imageSource;
        }
        const processedW = processed.width;
        const processedH = processed.height;
        if (clip.imageSource.width !== processedW || clip.imageSource.height !== processedH) {
          clip.imageSource.resize(processedW, processedH);
        }
        (clip.imageSource as { resource?: unknown }).resource = processed;
        clip.imageSource.update();
        clip.lastVideoFrame = processed;
        clip.nonVideoEffectCacheKey = cacheKey;
        if (blurFillIndex >= 0) {
          // Blur-fill fills the whole project frame; lay it out 1:1 ignoring the
          // clip transform, mirroring the native `Transform::center_fit` reset.
          clip.effectSourceW = this.context.width;
          clip.effectSourceH = this.context.height;
          clip.effectIgnoreTransform = true;
          this.context
            .getLayoutApplier()
            .applySpriteLayout(this.context.width, this.context.height, clip, {
              ignoreClipTransform: true,
            });
        } else {
          // Use the original (unpadded) source size so any blur "bleed" padding
          // baked into `processed` is treated as padding, not content.
          clip.effectSourceW = sourceW;
          clip.effectSourceH = sourceH;
          clip.effectIgnoreTransform = false;
          this.context.getLayoutApplier().applySpriteLayout(sourceW, sourceH, clip);
        }

        // The new processed bitmap is now committed as the texture resource,
        // so the old one is safe to dispose.
        if (prevProcessed) {
          safeDispose(prevProcessed);
          prevProcessed = null;
        }
      }
    } catch (err) {
      log.warn('[ClipResourceManager] Failed to apply effects to non-video clip:', err);
    } finally {
      if (sourceBitmap !== clip.bitmap) {
        sourceBitmap.close();
      }
    }
  }

  /**
   * Builds a cache key that captures all inputs affecting the WebGPU effect
   * output for a non-video clip: effect specs, project dimensions, and clip
   * content properties that determine the source bitmap.
   */
  private buildNonVideoEffectCacheKey(
    clip: CompositorClip,
    effectSpecs: ReturnType<typeof buildEffectSpecs>,
  ): string {
    const parts: string[] = [fastHash(effectSpecs), `${this.context.width}x${this.context.height}`];

    switch (clip.clipKind) {
      case 'text':
        parts.push(clip.text ?? '', fastHash(clip.style ?? {}));
        break;
      case 'shape':
        parts.push(
          clip.shapeType ?? '',
          clip.fillColor ?? '',
          clip.strokeColor ?? '',
          String(clip.strokeWidth ?? 0),
          fastHash(clip.shapeConfig ?? {}),
        );
        break;
      case 'solid':
        parts.push(clip.backgroundColor ?? '');
        break;
      case 'image':
        // Image bitmap is immutable after creation.
        parts.push('image');
        break;
      default:
        parts.push(clip.clipKind ?? '');
        break;
    }

    return parts.join('|');
  }

  private async getNonVideoClipBitmap(clip: CompositorClip): Promise<ImageBitmap | null> {
    if (clip.clipKind === 'image') {
      return clip.bitmap ?? null;
    }

    if (clip.clipKind === 'text') {
      if (!clip.canvas) return null;
      return await createImageBitmap(clip.canvas);
    }

    if (clip.clipKind === 'solid') {
      const canvas = new OffscreenCanvas(this.context.width, this.context.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = clip.backgroundColor ?? '#000000';
      ctx.fillRect(0, 0, this.context.width, this.context.height);
      return await createImageBitmap(canvas);
    }

    if (clip.clipKind === 'shape') {
      const app = this.context.getApp?.();
      if (!app || !clip.sprite) return null;
      // Render to a separate RenderTexture instead of app.canvas to avoid
      // interfering with the compositor's main canvas during effect processing.
      const rt = RenderTexture.create({
        width: this.context.width,
        height: this.context.height,
      });
      try {
        app.renderer.render({ container: clip.sprite, target: rt, clear: true });
        const canvas = app.renderer.extract.canvas(rt);
        return await createImageBitmap(canvas as unknown as OffscreenCanvas);
      } finally {
        try {
          rt.destroy();
        } catch {
          // ignore
        }
      }
    }

    return null;
  }

  public ensureClipRenderTexture(texture: RenderTexture | null): RenderTexture {
    return this.ensureRenderTexture(texture, this.context.width, this.context.height);
  }

  public ensureTransitionRenderTexture(texture: RenderTexture | null): RenderTexture {
    return this.ensureRenderTexture(texture, this.context.width, this.context.height);
  }

  public ensureCombinedTransitionTexture(texture: RenderTexture | null): RenderTexture {
    return this.ensureRenderTexture(texture, this.context.width * 2, this.context.height);
  }

  private ensureRenderTexture(
    texture: RenderTexture | null,
    width: number,
    height: number,
  ): RenderTexture {
    const valid =
      texture &&
      !(texture as { destroyed?: boolean }).destroyed &&
      typeof (texture as { uid?: number }).uid === 'number' &&
      texture.width === width &&
      texture.height === height;

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

    return RenderTexture.create({ width, height });
  }

  public async getVideoSampleForClip(params: {
    clip: CompositorClip;
    sampleTimeS: number;
    timelineTimeUs?: number;
    monitorSyncMode?: WebMonitorSyncMode;
    abortSignal?: AbortSignal;
  }): Promise<unknown | null> {
    const { clip, sampleTimeS, abortSignal } = params;
    const frameIndex = computeFrameIndex(clip, sampleTimeS);
    const cacheKey = buildVideoFrameCacheKey(clip, frameIndex);

    const cached = this.context.videoFrameCache.get(cacheKey);
    if (cached) {
      compositorPerfStats.onCacheHit();
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

    const decodeStartMs = performance.now();
    const promise = this.fetchVideoSampleForClip(
      clip,
      sampleTimeS,
      params.timelineTimeUs,
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
      compositorPerfStats.onDecode(performance.now() - decodeStartMs);
    }
  }

  private async fetchVideoSampleForClip(
    clip: CompositorClip,
    sampleTimeS: number,
    timelineTimeUs: number | undefined,
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
      this.storeDecodedFrame({ clip, frameIndex, cacheKey, timelineTimeUs, frame });

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

  // Sizes a decoded VideoFrame and inserts it into the frame cache under the given
  // key. Shared by the on-demand fetch path and the sequential decode-ahead warm so
  // both produce byte-identical cache entries.
  private storeDecodedFrame(params: {
    clip: CompositorClip;
    frameIndex: number;
    cacheKey: string;
    timelineTimeUs: number | undefined;
    frame: VideoFrame;
  }): void {
    const { clip, frame } = params;
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
      key: params.cacheKey,
      clipId: clip.itemId,
      frameIndex: params.frameIndex,
      timelineTimeUs: Math.max(
        0,
        Math.round(Number(params.timelineTimeUs) || Number(clip.startUs) || 0),
      ),
      frame,
      sizeBytes,
      width,
      height,
    });
  }

  // Decode-ahead of the currently-playing clips via a PERSISTENT sequential
  // iterator (`sink.samples(start, end)` — mediabunny's "decode each packet at
  // most once" pipeline). The iterator lives across prewarm ticks in
  // `clipWarmStreams`, so each tick only decodes the handful of NEW frames that
  // entered the look-ahead window — this is what makes decode-ahead cheap. A
  // fresh-per-tick batch (`samplesAtTimestamps`) was measured re-seeking from the
  // previous keyframe on every tick, which on long-GOP sources made the warm pass
  // itself hold the exclusive op queue for ~1.3s/3s and starve renders. The caller
  // must run this inside the compositor's exclusive op so the sequential read
  // never overlaps a render's read of the same sink.
  public async warmClipFrameWindow(params: {
    clip: CompositorClip;
    nowSourceTimeS: number;
    aheadSourceTimeS: number;
    timelineNowUs: number;
    speed: number;
  }): Promise<void> {
    const { clip } = params;
    const sink = clip.sink as unknown as {
      samples?: (
        startTimestamp?: number,
        endTimestamp?: number,
      ) => AsyncGenerator<{
        timestamp: number;
        toVideoFrame?: () => VideoFrame;
        close?: () => void;
      } | null>;
    } | null;
    if (!sink || typeof sink.samples !== 'function') return;

    const warmStartMs = performance.now();
    let stream = this.clipWarmStreams.get(clip.itemId);

    // Reopen when the playhead left the stream's coverage: moved backward since
    // the previous tick (the forward-only iterator can't rewind — compare against
    // the previous PLAYHEAD position, not the warm frontier, which is legitimately
    // ahead of the playhead during normal playback) or jumped forward past the
    // frontier (pulling the iterator across a large gap would decode every
    // in-between frame).
    const STALE_BACK_S = 0.05;
    const STALE_FORWARD_GAP_S = 1.0;
    if (
      stream &&
      (params.nowSourceTimeS < stream.lastNowS - STALE_BACK_S ||
        params.nowSourceTimeS > stream.lastTimeS + STALE_FORWARD_GAP_S)
    ) {
      this.disposeWarmStream(clip.itemId);
      stream = undefined;
    }

    if (!stream) {
      const rangeEndS =
        clip.sourceRangeDurationUs > 0
          ? (clip.sourceStartUs + clip.sourceRangeDurationUs) / 1_000_000
          : undefined;
      stream = {
        iterator: sink.samples(params.nowSourceTimeS, rangeEndS),
        lastTimeS: params.nowSourceTimeS,
        lastNowS: params.nowSourceTimeS,
        done: false,
      };
      this.clipWarmStreams.set(clip.itemId, stream);
    }
    stream.lastNowS = params.nowSourceTimeS;

    let framesStored = 0;
    while (!stream.done && stream.lastTimeS < params.aheadSourceTimeS) {
      const { value: sample, done } = await stream.iterator.next();
      if (done || !sample) {
        stream.done = true;
        break;
      }

      const sampleTimeS = Number(sample.timestamp);
      if (Number.isFinite(sampleTimeS)) {
        stream.lastTimeS = Math.max(stream.lastTimeS, sampleTimeS);
      }

      try {
        if (typeof sample.toVideoFrame !== 'function') continue;
        // Key by the sample's own PTS — the exact index the render path computes
        // for any playback time that sample-and-holds this frame.
        const frameIndex = computeFrameIndex(clip, sampleTimeS);
        const cacheKey = buildVideoFrameCacheKey(clip, frameIndex);
        if (this.context.videoFrameCache.get(cacheKey)) continue;

        // Timeline slot of this source frame (for scrub-locality eviction).
        const speed = params.speed > 0 ? params.speed : 1;
        const timelineTimeUs =
          params.timelineNowUs +
          Math.max(
            0,
            Math.round((sampleTimeS * 1_000_000 - params.nowSourceTimeS * 1_000_000) / speed),
          );

        this.storeDecodedFrame({
          clip,
          frameIndex,
          cacheKey,
          timelineTimeUs,
          frame: sample.toVideoFrame() as VideoFrame,
        });
        framesStored += 1;
      } finally {
        sample.close?.();
      }
    }

    compositorPerfStats.onPrewarm(framesStored, performance.now() - warmStartMs);
  }

  // Release a clip's persistent decode-ahead iterator (and its decoder resources).
  public disposeWarmStream(clipId: string): void {
    const stream = this.clipWarmStreams.get(clipId);
    if (!stream) return;
    this.clipWarmStreams.delete(clipId);
    void stream.iterator.return?.(undefined)?.catch?.(() => undefined);
  }

  // Drop decode-ahead iterators for every clip NOT in the given active set —
  // called from the prewarm tick so streams never outlive their clip's time under
  // the playhead.
  public pruneWarmStreams(activeClipIds: ReadonlySet<string>): void {
    for (const clipId of [...this.clipWarmStreams.keys()]) {
      if (!activeClipIds.has(clipId)) {
        this.disposeWarmStream(clipId);
      }
    }
  }

  public async updateClipTextureFromSample(
    sample: unknown,
    clip: CompositorClip,
    previewEffectsEnabled = true,
  ) {
    // The previously-bound frame is still referenced by `clip.imageSource.resource`.
    // The `resize()` calls below force pixi to re-upload the *current* resource, so
    // disposing the old frame before the new one is committed would make that upload
    // read a closed VideoFrame ("video frame that doesn't have back resource" → the
    // GPU texture is destroyed yet still used in submit). Defer disposal to `finally`,
    // after every success/return path has swapped in the new resource.
    let prevFrame: VideoFrame | ImageBitmap | null = null;
    try {
      const sampleObj = sample as { toVideoFrame?: () => VideoFrame };
      if (typeof sampleObj?.toVideoFrame === 'function') {
        prevFrame = clip.lastVideoFrame;
        clip.lastVideoFrame = null;

        const frame = sampleObj.toVideoFrame() as VideoFrame;

        try {
          // Display size, not coded size: codedWidth/Height include codec
          // alignment padding rows that are never shown. Sizing the layout from
          // the coded size skews the aspect ratio and breaks the blur-bleed
          // padding derivation (texture uploads use the display size).
          const frameW = Math.max(
            1,
            Math.round(
              Number(
                (frame as { displayWidth?: unknown }).displayWidth ??
                  (frame as { codedWidth?: unknown }).codedWidth ??
                  1,
              ),
            ),
          );
          const frameH = Math.max(
            1,
            Math.round(
              Number(
                (frame as { displayHeight?: unknown }).displayHeight ??
                  (frame as { codedHeight?: unknown }).codedHeight ??
                  1,
              ),
            ),
          );

          if (clip.sourceKind !== 'videoFrame' && clip.sprite) {
            (clip.sprite as Sprite).texture.source = clip.imageSource;
            (clip as { sourceKind: CompositorClip['sourceKind'] }).sourceKind = 'videoFrame';
          }

          if (clip.imageSource.width !== frameW || clip.imageSource.height !== frameH) {
            // pixi re-uploads the source's *current* resource during resize(). The
            // previously-bound frame may already be closed/evicted (e.g. when the
            // playhead jumps onto this clip), which surfaces as "Browser fails
            // extracting valid resource" / "video frame that doesn't have back
            // resource". Point the source at the fresh, valid frame first so the
            // resize-triggered upload reads it. Effects paths below overwrite the
            // resource (and resize again) with their padded output as needed.
            (clip.imageSource as { resource?: unknown }).resource = frame as unknown;
            clip.imageSource.resize(frameW, frameH);
          }

          // Run shared WGSL compute effects on the web when the clip has video
          // effects and preview is enabled. On failure, fall back to raw frame.
          const hasEffects = (clip.effects?.length ?? 0) > 0;
          const runner = this.context.computeRunner;
          if (previewEffectsEnabled && hasEffects && runner?.isReady()) {
            const effectSpecs = buildEffectSpecs(clip.effects);
            if (effectSpecs && effectSpecs.length > 0) {
              try {
                const blurFillIndex = effectSpecs.findIndex((e) => e.type === 'blur-fill');
                if (blurFillIndex >= 0) {
                  const blurFill = effectSpecs[
                    blurFillIndex
                  ] as import('~/types/generated/native-monitor/VideoEffectSpec').VideoEffectSpec & {
                    type: 'blur-fill';
                  };
                  const otherSpecs = effectSpecs.filter((_, i) => i !== blurFillIndex);
                  // Keep `frame` alive until we know the final result. Disposing it
                  // before blur-fill committed used to leave a closed VideoFrame as
                  // the texture resource whenever blur-fill returned null or threw.
                  let intermediate: VideoFrame | ImageBitmap | null = null;
                  if (otherSpecs.length > 0) {
                    intermediate = await runner.applyEffects(frame, otherSpecs);
                  }
                  const source: VideoFrame | ImageBitmap = intermediate ?? frame;
                  const projectW = this.context.width;
                  const projectH = this.context.height;
                  const processed = await runner.applyBlurFill({
                    source,
                    frameW: projectW,
                    frameH: projectH,
                    fgScale: blurFill.fg_scale,
                    bgScale: blurFill.bg_scale,
                    blur: blurFill.blur,
                    bgDim: blurFill.bg_dim,
                    bgSaturation: blurFill.bg_saturation,
                    tintColor: blurFill.tint_color,
                    tintStrength: blurFill.tint_strength,
                    fgOffsetY: blurFill.fg_offset_y,
                  });
                  if (processed) {
                    // Success: both the raw frame and the intermediate are consumed.
                    safeDispose(frame);
                    if (intermediate) safeDispose(intermediate as unknown as VideoFrame);
                    if (
                      clip.imageSource.width !== projectW ||
                      clip.imageSource.height !== projectH
                    ) {
                      clip.imageSource.resize(projectW, projectH);
                    }
                    (clip.imageSource as { resource?: unknown }).resource = processed;
                    clip.imageSource.update();
                    clip.lastVideoFrame = processed;
                    // Blur-fill fills the whole project frame; lay it out 1:1
                    // ignoring the clip transform, mirroring the native
                    // `Transform::center_fit` reset so both backends match.
                    clip.effectSourceW = projectW;
                    clip.effectSourceH = projectH;
                    clip.effectIgnoreTransform = true;
                    this.context
                      .getLayoutApplier()
                      .applySpriteLayout(projectW, projectH, clip, { ignoreClipTransform: true });
                    return;
                  }
                  // blur-fill failed: render the still-valid intermediate (the
                  // padded output of the other effects) if we produced one, else
                  // fall through to the raw-frame path below with the intact frame.
                  if (intermediate) {
                    safeDispose(frame);
                    const intermediateW = (intermediate as { width?: number }).width ?? frameW;
                    const intermediateH = (intermediate as { height?: number }).height ?? frameH;
                    if (
                      clip.imageSource.width !== intermediateW ||
                      clip.imageSource.height !== intermediateH
                    ) {
                      clip.imageSource.resize(intermediateW, intermediateH);
                    }
                    (clip.imageSource as { resource?: unknown }).resource = intermediate as unknown;
                    clip.imageSource.update();
                    clip.lastVideoFrame = intermediate;
                    clip.effectSourceW = frameW;
                    clip.effectSourceH = frameH;
                    clip.effectIgnoreTransform = false;
                    this.context.getLayoutApplier().applySpriteLayout(frameW, frameH, clip);
                    return;
                  }
                } else {
                  const processed = await runner.applyEffects(
                    frame,
                    effectSpecs as import('~/types/generated/native-monitor/VideoEffectSpec').VideoEffectSpec[],
                  );
                  if (processed) {
                    safeDispose(frame);
                    // The compute runner pads the output around the frame so blur /
                    // bloom can bleed beyond the original rectangle, so the bitmap
                    // is larger than frameW×frameH. The texture source must be sized
                    // to the *padded* bitmap — otherwise `LayoutApplier` infers
                    // padding=0 and the content/UV mapping is offset (content drifts
                    // into a corner with a black/transparent border). `applySpriteLayout`
                    // re-derives the padding from this source size and frameW/frameH.
                    const processedW = (processed as { width?: number }).width ?? frameW;
                    const processedH = (processed as { height?: number }).height ?? frameH;
                    if (
                      clip.imageSource.width !== processedW ||
                      clip.imageSource.height !== processedH
                    ) {
                      clip.imageSource.resize(processedW, processedH);
                    }
                    (clip.imageSource as { resource?: unknown }).resource = processed;
                    clip.imageSource.update();
                    clip.lastVideoFrame = processed;
                    clip.effectSourceW = frameW;
                    clip.effectSourceH = frameH;
                    clip.effectIgnoreTransform = false;
                    this.context.getLayoutApplier().applySpriteLayout(frameW, frameH, clip);
                    return;
                  }
                }
              } catch (computeErr) {
                log.warn(
                  '[VideoCompositor] WebGPU compute failed, falling back to raw frame:',
                  computeErr,
                );
              }
            }
          }

          (clip.imageSource as { resource?: unknown }).resource = frame as unknown;
          clip.imageSource.update();
          clip.lastVideoFrame = frame;

          // No effects applied — clear any stale stored dimensions so
          // applyClipLayoutForCurrentSource uses imageSource directly.
          clip.effectSourceW = undefined;
          clip.effectSourceH = undefined;
          clip.effectIgnoreTransform = undefined;
          this.context.getLayoutApplier().applySpriteLayout(frameW, frameH, clip);

          return;
        } catch (error) {
          safeDispose(frame);
          throw error;
        }
      }
    } catch (err) {
      log.warn('[VideoCompositor] VideoFrame path failed, falling back to canvas:', err);
    } finally {
      // The new frame is now committed as the texture resource (or we are about to
      // switch the source over to the canvas fallback), so the old frame is no
      // longer referenced by any pending GPU upload and is safe to release.
      if (prevFrame) safeDispose(prevFrame);
    }

    await this.context.canvasFallbackRenderer.drawSampleToCanvas(sample, clip);
  }

  public destroyClip(clip: CompositorClip, deps: { transitionManager: TransitionManager }) {
    this.disposeWarmStream(clip.itemId);
    // Primary samples are keyed `${itemId}:idx`; HUD/mask mock clips use the
    // suffixed ids `${itemId}_bg:`, `_ct:`, `_fr:` and `_mask:`. Drop in-flight
    // tracking for all of them so a destroyed clip leaves nothing behind.
    const inFlightPrefixes = [
      `${clip.itemId}:`,
      `${clip.itemId}_bg:`,
      `${clip.itemId}_ct:`,
      `${clip.itemId}_fr:`,
      `${clip.itemId}_mask:`,
    ];
    for (const key of this.inFlightSamples.keys()) {
      if (inFlightPrefixes.some((prefix) => key.startsWith(prefix))) {
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
