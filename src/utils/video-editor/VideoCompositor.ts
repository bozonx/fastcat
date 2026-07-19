import { TICKS_PER_MILLISECOND, TICKS_PER_SECOND } from '~/utils/time';
import { createDevLogger } from '~/utils/dev-logger';
import { TimelineActiveTracker } from './TimelineActiveTracker';
import { Sprite, Texture, ImageSource } from 'pixi.js';
import type { Application, Filter, RenderTexture } from 'pixi.js';
import type { WorkerVideoPayloadItem } from '../../composables/timeline/export/types';
import type { PreviewRenderOptions } from './worker-rpc';
import { VIDEO_CORE_LIMITS } from '../constants';
import type { VideoClipEffect } from '~/timeline/types';

// Internal modules
import type { CompositorClip, CompositorTrack } from './compositor/types';
import { ResourceManager } from './compositor/ResourceManager';
import { VideoFrameCache } from './compositor/VideoFrameCache';
import { EffectManager } from './compositor/EffectManager';
import { TransitionManager } from './compositor/TransitionManager';
import type { LayoutApplier } from './compositor/LayoutApplier';
import type { ClipResourceManager } from './compositor/ClipResourceManager';
import { compositorPerfStats } from './compositor/CompositorPerfStats';
import { StageTextureRenderer } from './compositor/StageTextureRenderer';
import type { ClipFactory } from './compositor/ClipFactory';
import type { TimelineClipLoader } from './compositor/TimelineClipLoader';
import type { HudMediaLoader } from './compositor/HudMediaLoader';
import type { MediaClipLoader } from './compositor/MediaClipLoader';
import type { RasterImageLoader, MediaSourceLoaderDeps } from './compositor/RasterImageLoader';
import type { TimelineApplyLifecycle } from './compositor/TimelineApplyLifecycle';
import type { TimelineClipLayoutUpdater } from './compositor/TimelineClipLayoutUpdater';
import type { TimelineClipAssetLoader } from './compositor/TimelineClipAssetLoader';
import type { TimelineLoadOrchestrator } from './compositor/TimelineLoadOrchestrator';
import type { TimelineActiveClipProcessor } from './compositor/TimelineActiveClipProcessor';
import type { TimelineTrackRebinder } from './compositor/TimelineTrackRebinder';
import type { TimelineUpdateLifecycle } from './compositor/TimelineUpdateLifecycle';
import type { TimelineLayoutOrchestrator } from './compositor/TimelineLayoutOrchestrator';
import type { TextRenderer } from './compositor/renderers/TextRenderer';
import type { ShapeRenderer } from './compositor/renderers/ShapeRenderer';
import type { CanvasFallbackRenderer } from './compositor/renderers/CanvasFallbackRenderer';
import { buildPrevClipByIdIndex, buildNextClipByIdIndex } from './compositor/trackRuntime';
import { RenderingEngine } from './compositor/RenderingEngine';
import type { FrameSampleOrchestrator } from './compositor/FrameSampleOrchestrator';
import { StageManager } from './compositor/StageManager';
import { TransitionRenderer } from './compositor/TransitionRenderer';
import {
  CompositorOperationQueue,
  type CompositorOperationPriority,
} from './compositor/CompositorOperationQueue';
import { resetCompositorClipsAfterContextRestored } from './compositor/contextRestore';
import { TrackRuntimeManager } from './compositor/TrackRuntimeManager';
import { createCompositorRuntime } from './compositor/CompositorRuntimeFactory';
import { CompositorRenderContextBuilder } from './compositor/CompositorRenderContextBuilder';
import { PixiCompositorLifecycle } from './compositor/PixiCompositorLifecycle';
import { WebGpuComputeRunner } from './compositor/WebGpuComputeRunner';
import { buildEffectSpecs } from '~/effects';
import { normalizeClipSpeed, resolveClipSourceTimeTicks } from './source-time';
import { TRANSFORM_DESIGN_BASE } from './clip-layout';
import type { PreviewEffectQuality } from '~/utils/preview-effect-quality';
import { DEFAULT_TRANSITION_MODE } from '~/transitions';
const log = createDevLogger('VideoCompositor');

export interface VideoCompositorInitOptions {
  rendererPreference?: 'webgl' | 'webgpu';
  designWidth?: number;
  designHeight?: number;
}

interface ClipWarmPlan {
  clip: CompositorClip;
  nowSourceTimeS: number;
  aheadSourceTimeS: number;
  rangeEndSourceTimeS?: number;
  timelineNowTicks: number;
  speed: number;
}

export class VideoCompositor {
  public app: Application | null = null;
  public canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  public clips: CompositorClip[] = [];
  public maxDurationTicks = 0;

  private width = 1920;
  private height = 1080;
  private designWidth = 1920;
  private designHeight = 1080;
  private clipById = new Map<string, CompositorClip>();
  private prevClipById = new Map<string, CompositorClip | null>();
  private nextClipById = new Map<string, CompositorClip | null>();
  private replacedClipIds = new Set<string>();
  private lastRenderedTimeTicks = 0;
  private contextLost = false;
  private previewEffectsEnabled = true;
  private previewEffectQuality: PreviewEffectQuality = 'ultra';
  private computeUnavailableWarningShown = false;

  private masterEffects: VideoClipEffect[] | null = null;
  private masterEffectFilters = new Map<string, Filter>();
  private stageSortDirty = true;
  private activeSortDirty = true;
  // Serializes rendering against timeline mutations. renderFrame is async and
  // touches VideoFrames / sprites / the frame cache across its internal awaits
  // (decode + shader transitions) before render() uploads them. Timeline edits
  // (updateTimelineLayout, loadTimeline) dispose those exact resources. If an
  // edit runs during a render's await window it closes the VideoFrame the GPU is
  // about to upload -> "texSubImage2D: can't texture a closed VideoFrame" and a
  // mid-playback decode storm (cache cleared under the renderer). One FIFO queue
  // guarantees a render and a mutation never interleave.
  //
  // INVARIANT: every entry point that disposes/recreates clip, texture or cache
  // resources MUST go through runExclusive (renderFrame, updateTimelineLayout,
  // clearClips, loadTimeline, the context-restore rebuild). The disposing cores
  // are private (`*Locked`) so they can only be reached via the queue; `destroy`
  // is the sole exception and instead *drains* the queue before tearing down.
  private opQueue = new CompositorOperationQueue();
  // Set the moment destroy() begins so queued/late entry points bail instead of
  // touching resources that teardown is about to free.
  private disposed = false;
  private timelineLoadAbortController: AbortController | null = null;
  private clipPreferBitmapFallback = new Map<string, boolean>();
  // Cached blit resources for the adjustment-clip path. Reused across frames to
  // avoid creating/destroying a Texture + Sprite per adjustment clip per frame.
  private adjustmentBlitSource: ImageSource | null = null;
  private adjustmentBlitSprite: Sprite | null = null;
  private videoFrameCache = new VideoFrameCache(
    Math.max(0, Number(VIDEO_CORE_LIMITS.MAX_VIDEO_FRAME_CACHE_MB) || 0) * 1024 * 1024,
  );

  // Managers
  private resourceManager = new ResourceManager();
  private effectManager = new EffectManager();
  private transitionManager = new TransitionManager();
  private layoutApplier!: LayoutApplier;

  // Renderers
  private textRenderer!: TextRenderer;
  private shapeRenderer!: ShapeRenderer;
  private canvasFallbackRenderer!: CanvasFallbackRenderer;
  private timelineClipLoader!: TimelineClipLoader;
  private hudMediaLoader!: HudMediaLoader;
  private mediaClipLoader!: MediaClipLoader;
  private rasterImageLoader!: RasterImageLoader;
  private clipFactory!: ClipFactory;
  private timelineClipAssetLoader!: TimelineClipAssetLoader;
  private timelineLoadOrchestrator!: TimelineLoadOrchestrator;
  private timelineActiveClipProcessor!: TimelineActiveClipProcessor;
  private timelineApplyLifecycle!: TimelineApplyLifecycle;
  private timelineClipLayoutUpdater!: TimelineClipLayoutUpdater;
  private timelineTrackRebinder!: TimelineTrackRebinder;
  private timelineUpdateLifecycle!: TimelineUpdateLifecycle;
  private timelineLayoutOrchestrator!: TimelineLayoutOrchestrator;
  private renderingEngine = new RenderingEngine();
  private frameSampleOrchestrator!: FrameSampleOrchestrator;
  private stageManager = new StageManager();
  private transitionRenderer = new TransitionRenderer();
  private clipResourceManager!: ClipResourceManager;
  private stageTextureRenderer: StageTextureRenderer | null = null;
  private trackRuntimeManager = new TrackRuntimeManager({
    toVideoEffects: (value) => this.toVideoEffects(value),
  });
  private renderContextBuilder = new CompositorRenderContextBuilder();
  private pixiLifecycle = new PixiCompositorLifecycle();
  private computeRunner = new WebGpuComputeRunner();

  private readonly activeTracker = new TimelineActiveTracker<CompositorClip>({
    getId: (clip) => clip.itemId,
    getStartTicks: (clip) => clip.startTicks,
    getEndTicks: (clip) => clip.endTicks,
  });

  constructor() {
    this.resetRuntimeDependencies();
  }

  public supportsComputeEffects(): boolean {
    return this.computeRunner.isReady();
  }

  public get tracks(): CompositorTrack[] {
    return this.trackRuntimeManager.all;
  }

  public set tracks(tracks: CompositorTrack[]) {
    this.trackRuntimeManager.setAll(tracks);
  }

  public get trackById(): Map<string, CompositorTrack> {
    return this.trackRuntimeManager.byId;
  }

  public set trackById(trackById: Map<string, CompositorTrack>) {
    this.trackRuntimeManager.setById(trackById);
  }

  private resetRuntimeDependencies() {
    const runtime = createCompositorRuntime({
      width: this.width,
      height: this.height,
      designWidth: this.designWidth,
      designHeight: this.designHeight,
      clipPreferBitmapFallback: this.clipPreferBitmapFallback,
      resourceManager: this.resourceManager,
      videoFrameCache: this.videoFrameCache,
      computeRunner: this.computeRunner,
      getApp: () => this.app!,
    });

    this.layoutApplier = runtime.layoutApplier;
    this.textRenderer = runtime.textRenderer;
    this.shapeRenderer = runtime.shapeRenderer;
    this.canvasFallbackRenderer = runtime.canvasFallbackRenderer;
    this.timelineClipLoader = runtime.timelineClipLoader;
    this.hudMediaLoader = runtime.hudMediaLoader;
    this.mediaClipLoader = runtime.mediaClipLoader;
    this.rasterImageLoader = runtime.rasterImageLoader;
    this.clipFactory = runtime.clipFactory;
    this.timelineClipAssetLoader = runtime.timelineClipAssetLoader;
    this.timelineLoadOrchestrator = runtime.timelineLoadOrchestrator;
    this.timelineActiveClipProcessor = runtime.timelineActiveClipProcessor;
    this.timelineApplyLifecycle = runtime.timelineApplyLifecycle;
    this.timelineClipLayoutUpdater = runtime.timelineClipLayoutUpdater;
    this.timelineTrackRebinder = runtime.timelineTrackRebinder;
    this.timelineUpdateLifecycle = runtime.timelineUpdateLifecycle;
    this.timelineLayoutOrchestrator = runtime.timelineLayoutOrchestrator;
    this.frameSampleOrchestrator = runtime.frameSampleOrchestrator;
    this.clipResourceManager = runtime.clipResourceManager;
  }

  private ensureStageTextureRenderer(app: Application): StageTextureRenderer {
    if (!this.stageTextureRenderer) {
      this.stageTextureRenderer = new StageTextureRenderer({
        app,
        width: this.width,
        height: this.height,
        getTrackById: (trackId) => this.trackRuntimeManager.getById(trackId),
      });
    }
    return this.stageTextureRenderer;
  }

  private ensureClipRenderTexture(texture: RenderTexture | null): RenderTexture {
    return this.clipResourceManager.ensureClipRenderTexture(texture);
  }

  private setClipSpriteVisible(clip: CompositorClip, visible: boolean) {
    if (!clip.sprite || (clip.sprite as { destroyed?: boolean }).destroyed) {
      return false;
    }

    clip.sprite.visible = visible;
    return true;
  }

  private async prepareAdjustmentClips(active: CompositorClip[]) {
    if (!this.app?.renderer) return;

    const adjustmentClips = active
      .filter(
        (clip) =>
          clip.clipKind === 'adjustment' &&
          clip.sprite &&
          !clip.sprite.destroyed &&
          clip.sprite.visible,
      )
      .sort(
        (a, b) =>
          a.layer - b.layer || a.startTicks - b.startTicks || a.itemId.localeCompare(b.itemId),
      );

    for (const clip of this.clips) {
      if (clip.clipKind !== 'adjustment') continue;
      if (!adjustmentClips.includes(clip) && clip.sprite && !clip.sprite.destroyed) {
        try {
          if (clip.sprite.texture && clip.sprite.texture !== Texture.EMPTY) {
            clip.sprite.texture = Texture.EMPTY;
          }
        } catch {
          // ignore PixiJS internal errors on reset
        }
      }
    }

    const runner = this.computeRunner;
    for (const clip of adjustmentClips) {
      const effectSpecs = clip.animatedEffectSpecs ?? buildEffectSpecs(clip.effects);
      if (
        !this.previewEffectsEnabled ||
        !effectSpecs ||
        effectSpecs.length === 0 ||
        !runner?.isReady()
      ) {
        clip.adjustmentSourceTexture = this.ensureClipRenderTexture(
          clip.adjustmentSourceTexture ?? null,
        );
        this.renderLowerLayersToTexture(clip.layer, clip.adjustmentSourceTexture);
        if (clip.sprite) clip.sprite.texture = clip.adjustmentSourceTexture;
        continue;
      }

      let sourceBitmap: ImageBitmap | null = null;
      let processedBitmap: ImageBitmap | null = null;
      try {
        clip.adjustmentSourceTexture = this.ensureClipRenderTexture(
          clip.adjustmentSourceTexture ?? null,
        );
        this.renderLowerLayersToTexture(clip.layer, clip.adjustmentSourceTexture);
        const blurFillIndex = effectSpecs.findIndex((effect) => effect.type === 'blur-fill');
        let renderedOnGpu = false;
        if (blurFillIndex >= 0) {
          const blurFill = effectSpecs[
            blurFillIndex
          ] as import('~/types/generated/native-monitor/VideoEffectSpec').VideoEffectSpec & {
            type: 'blur-fill';
          };
          const otherSpecs = effectSpecs.filter((_, index) => index !== blurFillIndex);
          renderedOnGpu =
            otherSpecs.length === 0
              ? Boolean(
                  typeof runner.applyBlurFillToTexture === 'function' &&
                  runner.applyBlurFillToTexture({
                    source: clip.adjustmentSourceTexture,
                    target: clip.adjustmentSourceTexture,
                    frameW: this.width,
                    frameH: this.height,
                    fgScale: blurFill.fg_scale,
                    bgScale: blurFill.bg_scale,
                    blur: blurFill.blur,
                    bgDim: blurFill.bg_dim,
                    bgSaturation: blurFill.bg_saturation,
                    tintColor: blurFill.tint_color,
                    tintStrength: blurFill.tint_strength,
                    fgOffsetY: blurFill.fg_offset_y,
                  }),
                )
              : Boolean(
                  typeof runner.applyEffectsThenBlurFillToTexture === 'function' &&
                  runner.applyEffectsThenBlurFillToTexture({
                    source: clip.adjustmentSourceTexture,
                    target: clip.adjustmentSourceTexture,
                    effects: otherSpecs,
                    frameW: this.width,
                    frameH: this.height,
                    fgScale: blurFill.fg_scale,
                    bgScale: blurFill.bg_scale,
                    blur: blurFill.blur,
                    bgDim: blurFill.bg_dim,
                    bgSaturation: blurFill.bg_saturation,
                    tintColor: blurFill.tint_color,
                    tintStrength: blurFill.tint_strength,
                    fgOffsetY: blurFill.fg_offset_y,
                    options: { enablePadding: false },
                  }),
                );
        } else {
          renderedOnGpu =
            typeof runner.applyEffectsToTexture === 'function' &&
            runner.applyEffectsToTexture({
              source: clip.adjustmentSourceTexture,
              target: clip.adjustmentSourceTexture,
              effects: effectSpecs,
              options: { enablePadding: false },
            });
        }
        if (renderedOnGpu) {
          compositorPerfStats.onGpuComputePath('adjustment', 'zero-copy');
          if (clip.sprite) clip.sprite.texture = clip.adjustmentSourceTexture;
          continue;
        }

        sourceBitmap = await this.ensureStageTextureRenderer(this.app).renderLowerLayersToBitmap(
          clip.layer,
          {
            // Pixi's browser capture anti-aliases the top sprite against the
            // opaque background at the project boundary, leaving a dark fringe
            // that can span ~2px. With no effect padding, the blur clamps to
            // that edge and spreads it inward as a dark vignette (visible on
            // adjustment-clip blur but not on direct-clip blur, which pads).
            // Inset past the whole AA band so the nearest *clean* interior
            // texels become the frame boundary, matching the native full-frame
            // raster (which feeds a GPU texture straight into the effect shader
            // with no readback fringe).
            edgeInsetPixels: 2,
          },
        );
        // Native adjustment layers always process the project-sized scene
        // without effect padding. Keep the web path identical: a padded bitmap
        // is larger than the adjustment render target and shifts the result
        // when "blur past edges" is enabled.
        processedBitmap = await runner.applyEffects(sourceBitmap, effectSpecs, {
          enablePadding: false,
        });

        compositorPerfStats.onGpuComputePath(
          'adjustment',
          processedBitmap ? 'bitmap-fallback' : 'raw-fallback',
        );
        const output = processedBitmap ?? sourceBitmap;
        // Reuse cached ImageSource + Sprite to avoid per-frame GPU allocations.
        if (!this.adjustmentBlitSource) {
          this.adjustmentBlitSource = new ImageSource({
            resource: output as unknown as OffscreenCanvas,
          });
          const blitTexture = new Texture({ source: this.adjustmentBlitSource });
          this.adjustmentBlitSprite = new Sprite(blitTexture);
        } else {
          const w = output.width;
          const h = output.height;
          if (this.adjustmentBlitSource.width !== w || this.adjustmentBlitSource.height !== h) {
            this.adjustmentBlitSource.resize(w, h);
          }
          (this.adjustmentBlitSource as { resource?: unknown }).resource = output;
          this.adjustmentBlitSource.update();
        }
        const sprite = this.adjustmentBlitSprite!;
        sprite.anchor.set(0, 0);
        sprite.x = 0;
        sprite.y = 0;
        sprite.width = this.width;
        sprite.height = this.height;
        clip.adjustmentSourceTexture = this.ensureClipRenderTexture(
          clip.adjustmentSourceTexture ?? null,
        );
        this.app.renderer.render({
          container: sprite,
          target: clip.adjustmentSourceTexture,
          clear: true,
        });
      } catch (err) {
        log.warn('[VideoCompositor] Adjustment rendering failed:', err);
      } finally {
        processedBitmap?.close();
        sourceBitmap?.close();
      }

      if (clip.sprite && clip.adjustmentSourceTexture) {
        clip.sprite.texture = clip.adjustmentSourceTexture;
      }
    }
  }

  private async getVideoSampleForClip(params: {
    clip: CompositorClip;
    sampleTimeS: number;
    timelineTimeTicks?: number;
    monitorSyncMode?: 'smooth' | 'balanced' | 'strict';
    abortSignal?: AbortSignal;
  }): Promise<unknown | null> {
    return this.clipResourceManager.getVideoSampleForClip(params);
  }

  private toVideoEffects(value: unknown): VideoClipEffect[] | undefined {
    if (!Array.isArray(value)) return undefined;

    return value.filter((effect): effect is VideoClipEffect => {
      if (!effect || typeof effect !== 'object') return false;
      if (
        typeof (effect as { type?: string }).type !== 'string' ||
        !(effect as { type?: string }).type?.length
      )
        return false;

      if ((effect as { target?: string }).target === 'audio') return false;

      // UI ClipEffects always carry an id. Parity fixtures and some callers pass
      // already-formed VideoEffectSpec objects (e.g. { type: "brightness", value: 1.5 })
      // without an id; accept them as video effects so they can reach the GPU runner.
      return true;
    });
  }

  public buildTrackRuntimeList(timelineItems: unknown[]) {
    return this.trackRuntimeManager.buildList(timelineItems);
  }

  public async applyShaderTransitions(activeClips: CompositorClip[], currentTimeTicks: number) {
    if (!this.app) return;

    const stageTextureRenderer = this.ensureStageTextureRenderer(this.app);

    await this.transitionRenderer.applyShaderTransitions(activeClips, currentTimeTicks, {
      app: this.app,
      clips: this.clips,
      width: this.width,
      height: this.height,
      previewEffectQuality: this.previewEffectQuality,
      computeRunner: this.computeRunner,
      transitionManager: this.transitionManager,
      stageTextureRenderer,
      getTrackById: (trackId) => this.trackRuntimeManager.getById(trackId),
      getActiveTransitionState: (clip, timeTicks) =>
        this.getActiveTransitionState(clip, timeTicks) as {
          opacity: number;
          progress: number;
          mode?: string;
        } | null,
      ensureTransitionRenderTexture: (texture) =>
        this.clipResourceManager.ensureTransitionRenderTexture(texture),
      findPrevClipOnLayer: (clip) => this.findPrevClipOnLayer(clip),
      findNextClipOnLayer: (clip) => this.findNextClipOnLayer(clip),
      createAbortController: (key) => this.resourceManager.createAbortController(key),
      removeAbortController: (key) => this.resourceManager.removeAbortController(key),
      getVideoSampleForClip: (params) => this.getVideoSampleForClip(params),
      updateClipTextureFromSample: (sample, clip) => this.updateClipTextureFromSample(sample, clip),
    });
  }

  private getTrackRuntimeForClip(
    clip: Pick<CompositorClip, 'trackId' | 'layer'>,
  ): CompositorTrack | null {
    return this.trackRuntimeManager.getForClip(clip);
  }

  private rebuildPrevClipIndex() {
    this.prevClipById = buildPrevClipByIdIndex(this.clips);
    this.nextClipById = buildNextClipByIdIndex(this.clips);
  }

  private registerLoadedClip(params: {
    clip: CompositorClip;
    nextClips: CompositorClip[];
    nextClipById: Map<string, CompositorClip>;
  }) {
    const { clip, nextClips, nextClipById } = params;
    if (!this.app) {
      nextClips.push(clip);
      nextClipById.set(clip.itemId, clip);
      return;
    }
    const trackRuntime = this.getTrackRuntimeForClip(clip);
    this.clipFactory.attachClipSprite({
      clip,
      trackRuntime,
      stage: this.app.stage,
    });
    nextClips.push(clip);
    nextClipById.set(clip.itemId, clip);
  }

  private replaceExistingClip(params: { reusable: CompositorClip | undefined; itemId: string }) {
    const { reusable, itemId } = params;
    if (!reusable) {
      return;
    }
    this.destroyClip(reusable);
    this.replacedClipIds.add(itemId);
  }

  private resolveFixedClipEnd(params: {
    startTicks: number;
    requestedTimelineDurationTicks: number;
    sequentialTimeTicks: number;
  }) {
    const endTicks = params.startTicks + Math.max(0, params.requestedTimelineDurationTicks);
    return {
      endTicks,
      sequentialTimeTicks: Math.max(params.sequentialTimeTicks, endTicks),
    };
  }

  private applyLoadedTimeline(params: {
    nextClips: CompositorClip[];
    nextClipById: Map<string, CompositorClip>;
    sequentialTimeTicks: number;
  }) {
    const applied = this.timelineApplyLifecycle.apply({
      previousClipById: this.clipById,
      replacedClipIds: this.replacedClipIds,
      nextClips: params.nextClips,
      nextClipById: params.nextClipById,
      sequentialTimeTicks: params.sequentialTimeTicks,
      destroyClip: (clip) => this.destroyClip(clip),
    });

    this.clips = applied.clips;
    this.clipById = applied.clipById;
    this.rebuildPrevClipIndex();
    this.maxDurationTicks = applied.maxDurationTicks;
    this.lastRenderedTimeTicks = applied.lastRenderedTimeTicks;
    this.activeTracker.reset();
    this.hideAllClipSprites();
    this.stageSortDirty = applied.stageSortDirty;
    this.activeSortDirty = applied.activeSortDirty;

    return this.maxDurationTicks;
  }

  private hideAllClipSprites() {
    for (const clip of this.clips) {
      if (clip.sprite && !clip.sprite.destroyed) {
        clip.sprite.visible = false;
      }
    }
  }

  // Per-frame safety net: hide every clip sprite that is not in the active set.
  //
  // The render is incremental — a clip is normally hidden only by the tracker's
  // onDeactivate when it leaves the active set. That alone is not enough for
  // non-video clips (image/text/shape/hud/solid/adjustment), which have no
  // per-frame "am I still in range" self-check the way video clips do, and for
  // clips made visible *outside* the tracker (a transition's outgoing "shadow"
  // clip in FrameSampleOrchestrator.buildBlendShadowRequests). If such a clip is
  // never re-hidden — a missed/late onDeactivate, a transition step that bails
  // before it cleans up, or a window-boundary mismatch — it strands on screen
  // even though the playhead has moved off it. Hiding all inactive sprites at the
  // start of every frame removes that dependency on call order. Sprites that are
  // legitimately needed this frame (active clips, in-window shadow/transition
  // peers) are made visible again later in the same render before it presents, so
  // there is no flicker; only the final state at present time reaches the canvas.
  private hideInactiveClipSprites(activeClips: CompositorClip[]) {
    if (this.clips.length === 0 || activeClips.length === this.clips.length) {
      return;
    }
    const activeSet = new Set(activeClips);
    for (const clip of this.clips) {
      if (activeSet.has(clip)) continue;
      const sprite = clip.sprite;
      if (sprite && !sprite.destroyed && sprite.visible) {
        sprite.visible = false;
      }
    }
  }

  async init(
    width: number,
    height: number,
    bgColor = '#000',
    offscreen = true,
    externalCanvas?: OffscreenCanvas | HTMLCanvasElement,
    options: VideoCompositorInitOptions = {},
  ): Promise<void> {
    if (this.app) {
      try {
        await this.destroy();
      } catch (err) {
        log.error('Failed to destroy previous application instance', err);
        this.app = null;
      }
    }
    // Re-init of a reused instance: clear the disposed flag set by destroy() so
    // this freshly-initialized compositor accepts renders/mutations again.
    this.disposed = false;

    this.width = width;
    this.height = height;
    // Text font size / letter-spacing / padding are authored in the fixed
    // 1920x1080 design space (TRANSFORM_DESIGN_BASE), the same convention as clip
    // transforms and the native compositor's glyph render-scale
    // (src-tauri/.../layer_builder.rs). Defaulting to the render `width` here
    // sized glyphs off the project pixels instead, making web text
    // 1920/projectWidth times larger than native on non-1080p projects (e.g. 1.5x
    // on a 1280-wide project). Callers may still override for special cases.
    this.designWidth =
      typeof options.designWidth === 'number' && Number.isFinite(options.designWidth)
        ? Math.max(1, options.designWidth)
        : TRANSFORM_DESIGN_BASE.width;
    this.designHeight =
      typeof options.designHeight === 'number' && Number.isFinite(options.designHeight)
        ? Math.max(1, options.designHeight)
        : TRANSFORM_DESIGN_BASE.height;
    this.contextLost = false;
    this.resetRuntimeDependencies();

    const { app, canvas } = await this.pixiLifecycle.init({
      width,
      height,
      bgColor,
      offscreen,
      externalCanvas,
      options,
      onContextLost: this.onContextLost,
      onContextRestored: this.onContextRestored,
    });
    this.app = app;
    this.canvas = canvas;

    // Complete compute initialization before the first render so effects are
    // never silently omitted during the adapter/device startup window. In WebGPU
    // mode the runner shares Pixi's device, which is required for zero-copy
    // RenderTexture processing.
    if (
      !this.computeRunner.initFromPixiRenderer(
        app.renderer as unknown as Parameters<WebGpuComputeRunner['initFromPixiRenderer']>[0],
      )
    ) {
      await this.computeRunner.init();
    }
    this.computeUnavailableWarningShown = false;

    this.ensureStageTextureRenderer(this.app);
  }

  /**
   * Sets the effect / antialiasing quality tier used by subsequent renders.
   * Thumbnail extraction lowers this to `'low'` so blur/bloom sample budgets stay
   * cheap for a small downscaled still.
   */
  setPreviewEffectQuality(quality: PreviewEffectQuality): void {
    this.previewEffectQuality = quality;
    this.computeRunner.setPreviewEffectQuality(quality);
  }

  private onContextLost = (event: Event) => {
    event.preventDefault();
    log.warn('WebGL/WebGPU context lost!');
    this.contextLost = true;
  };

  private onContextRestored = () => {
    if (this.disposed) return;
    // Rebuild on the op queue so it never disposes a VideoFrame / cache entry
    // while a render is mid-flight — same no-interleave invariant as the timeline
    // mutations. contextLost stays true until the queued rebuild runs, so any
    // renders queued ahead of it harmlessly no-op.
    void this.runExclusive(() => this.rebuildAfterContextRestoredLocked(), 'contextRestore');
  };

  private rebuildAfterContextRestoredLocked() {
    log.warn('WebGL/WebGPU context restored!');
    this.contextLost = false;
    this.stageSortDirty = true;
    this.videoFrameCache.clear();
    resetCompositorClipsAfterContextRestored(this.clips);
    // A device loss tears the compute runner down (isReady() flips false) and
    // nothing else re-initializes it, so effects would silently stay off until
    // a full compositor re-init. Re-attach to the restored Pixi device (no-op
    // when the runner is still ready on the same device), falling back to an
    // owned device like init() does.
    if (this.app) {
      const attached = this.computeRunner.initFromPixiRenderer(
        this.app.renderer as unknown as Parameters<WebGpuComputeRunner['initFromPixiRenderer']>[0],
      );
      if (!attached) {
        void this.computeRunner.init();
      }
    }
  }

  async loadTimeline(
    timelineClips: ReadonlyArray<WorkerVideoPayloadItem>,
    deps: MediaSourceLoaderDeps,
    checkCancel?: () => boolean,
  ): Promise<number> {
    if (this.disposed || !this.app) throw new Error('VideoCompositor not initialized');

    // Abort a previous in-flight load synchronously (before queueing) so a
    // superseding load cancels the running one, which then checks isCancelled
    // and bails fast, freeing the queue slot.
    this.timelineLoadAbortController?.abort();
    const abortController = new AbortController();
    this.timelineLoadAbortController = abortController;
    try {
      return await this.runExclusive((signal) => {
        // The queue watchdog aborts via `signal`; forward it to the load's own
        // cancellation so a stuck load unwinds and releases the queue.
        if (signal.aborted) abortController.abort();
        else signal.addEventListener('abort', () => abortController.abort(), { once: true });
        return this.loadTimelineLocked(timelineClips, deps, checkCancel, abortController.signal);
      }, 'loadTimeline');
    } finally {
      if (this.timelineLoadAbortController === abortController) {
        this.timelineLoadAbortController = null;
      }
    }
  }

  /**
   * Runs `fn` exclusively against every other rendering/mutation op on this
   * compositor, in FIFO order. The chain advances regardless of whether a step
   * resolves or rejects, and never retains a rejection (so it can't surface as
   * an unhandled rejection or stall the queue).
   *
   * Head-of-line protection: each op gets an AbortSignal that fires after
   * OP_QUEUE_WATCHDOG_MS. A cooperative op (renderFrame, loadTimeline) wires the
   * signal to its own cancellation so a stalled decode/load unwinds instead of
   * freezing every queued edit behind it. The queue still only advances once the
   * op *actually* settles — the watchdog nudges settlement, it never runs the
   * next op concurrently, so the no-interleave invariant is preserved.
   */
  private runExclusive<T>(
    fn: (signal: AbortSignal) => Promise<T> | T,
    label = 'op',
    priority: CompositorOperationPriority = 'interactive',
  ): Promise<T> {
    return this.opQueue.run(fn, label, priority);
  }

  private async loadTimelineLocked(
    timelineClips: ReadonlyArray<WorkerVideoPayloadItem>,
    deps: MediaSourceLoaderDeps,
    checkCancel?: () => boolean,
    abortSignal?: AbortSignal,
  ): Promise<number> {
    const isCancelled = () => abortSignal?.aborted === true || checkCancel?.() === true;
    const meta = timelineClips.find((x) => x && typeof x === 'object' && x.kind === 'meta');
    const nextMaster = meta
      ? (this.toVideoEffects((meta as { masterEffects?: unknown }).masterEffects) ?? null)
      : null;
    this.masterEffects = nextMaster;
    this.trackRuntimeManager.sync(timelineClips, this.app);
    this.stageSortDirty = true;

    const { Input, BlobSource, VideoSampleSink, ALL_FORMATS } = await import('mediabunny');
    const { nextClips, nextClipById, sequentialTimeTicks } =
      await this.timelineLoadOrchestrator.load({
        timelineClips,
        deps,
        mediabunny: {
          Input: Input as unknown as new (params: unknown) => {
            getPrimaryVideoTrack(): Promise<
              import('./compositor/MediaClipLoader').MediabunnyTrack | null
            >;
          },
          BlobSource,
          VideoSampleSink: VideoSampleSink as unknown as new (track: unknown) => unknown,
          ALL_FORMATS,
        },
        callbacks: {
          checkCancel: isCancelled,
          abortSignal,
          destroyClip: (clip) => this.destroyClip(clip),
          getExistingClipById: (itemId) => this.clipById.get(itemId),
          getFallbackTrackId: (clipData) =>
            this.getTrackRuntimeForClip({
              layer: Math.round(Number((clipData as { layer?: number }).layer ?? 0)),
            })?.id ?? null,
          getTrackRuntimeForClip: (clip) => this.getTrackRuntimeForClip(clip),
          applySolidLayout: (clip) => this.layoutApplier.applySolidLayout(clip),
          replaceExistingClip: (params) => this.replaceExistingClip(params),
          resolveFixedClipEnd: (params) => this.resolveFixedClipEnd(params),
          registerLoadedClip: (params) => this.registerLoadedClip(params),
          toVideoEffects: (value) => this.toVideoEffects(value),
        },
      });
    if (isCancelled()) {
      for (const clip of nextClips) {
        if (!this.clipById.has(clip.itemId)) {
          this.destroyClip(clip);
        }
      }
      const abortErr = new Error('Timeline load request was superseded');
      (abortErr as Error).name = 'AbortError';
      throw abortErr;
    }
    return this.applyLoadedTimeline({
      nextClips,
      nextClipById,
      sequentialTimeTicks,
    });
  }

  updateTimelineLayout(timelineClips: ReadonlyArray<WorkerVideoPayloadItem>): Promise<number> {
    if (this.disposed) return Promise.resolve(this.maxDurationTicks);
    return this.runExclusive(
      () => this.updateTimelineLayoutLocked(timelineClips),
      'updateTimelineLayout',
    );
  }

  prewarmVideoFrames(
    timeTicks: number,
    lookaheadTicks = (TICKS_PER_SECOND * 5) / 2,
  ): Promise<void> {
    if (this.disposed) return Promise.resolve();
    return this.runExclusive(
      (signal) => this.prewarmVideoFramesLocked(timeTicks, lookaheadTicks, signal),
      'prewarmVideoFrames',
      'background',
    );
  }

  // Build sequential decode-ahead windows for visible clips and the source handles
  // consumed by adjacent transitions. Reverse and freeze-frame clips are skipped:
  // their source time moves backward and cannot reuse the forward-only iterator.
  private buildActiveClipWarmPlans(timeTicks: number): ClipWarmPlan[] {
    const nowTicks = Math.max(0, Math.round(timeTicks));
    const maxFrames = Math.max(0, Math.round(VIDEO_CORE_LIMITS.MAX_ACTIVE_PREWARM_FRAMES));
    if (maxFrames === 0) return [];

    const plansByClipId = new Map<string, ClipWarmPlan>();
    const headHorizonTicks = Math.max(0, Math.round(VIDEO_CORE_LIMITS.PREWARM_HEAD_HORIZON_TICKS));

    const addPlan = (plan: ClipWarmPlan) => {
      const current = plansByClipId.get(plan.clip.itemId);
      if (!current) {
        plansByClipId.set(plan.clip.itemId, plan);
        return;
      }

      current.nowSourceTimeS = Math.min(current.nowSourceTimeS, plan.nowSourceTimeS);
      current.aheadSourceTimeS = Math.max(current.aheadSourceTimeS, plan.aheadSourceTimeS);
      current.timelineNowTicks = Math.min(current.timelineNowTicks, plan.timelineNowTicks);
      if (plan.rangeEndSourceTimeS !== undefined) {
        current.rangeEndSourceTimeS = Math.max(
          current.rangeEndSourceTimeS ?? plan.rangeEndSourceTimeS,
          plan.rangeEndSourceTimeS,
        );
      }
    };

    const getFrameRate = (clip: CompositorClip) =>
      typeof clip.frameRate === 'number' && Number.isFinite(clip.frameRate) && clip.frameRate > 0
        ? clip.frameRate
        : 30;

    const getAheadSourceTicks = (clip: CompositorClip, sourceTicks: number, speed: number) =>
      sourceTicks + Math.round((maxFrames / getFrameRate(clip)) * TICKS_PER_SECOND * speed);

    for (const clip of this.clips) {
      if (
        clip.clipKind !== 'video' ||
        !clip.sink ||
        typeof clip.freezeFrameSourceTicks === 'number' ||
        // Cover clips under the playhead AND imminent upcoming clips (starting
        // within the head horizon) so a cut's head window is decoded BEFORE the
        // crossing; exclude finished clips and ones still beyond the horizon.
        clip.startTicks > nowTicks + headHorizonTicks ||
        clip.endTicks <= nowTicks
      ) {
        continue;
      }

      const speed = normalizeClipSpeed(clip.speed);
      if (speed < 0) continue; // sequential decode-ahead is forward-only

      // For a not-yet-entered clip the playhead is before it, so warm from its
      // first source frame (localTime 0). Clamping unifies both cases; when the
      // playhead later crosses in, `warmClipFrameWindow` sees `nowSourceTime`
      // still ≈ the first frame and continues the same iterator (no reopen).
      const localTimeTicks = Math.max(0, nowTicks - clip.startTicks);
      const nowSourceTicks = resolveClipSourceTimeTicks({
        localTimeTicks,
        sourceStartTicks: clip.sourceStartTicks,
        sourceRangeDurationTicks: clip.sourceRangeDurationTicks,
        speed,
        frameRate: clip.frameRate,
      });
      // Source-domain look-ahead; scaled by |speed| so fast playback still covers
      // the same wall-clock horizon.
      const sourceRangeEndTicks = clip.sourceStartTicks + clip.sourceRangeDurationTicks;
      addPlan({
        clip,
        nowSourceTimeS: nowSourceTicks / TICKS_PER_SECOND,
        aheadSourceTimeS:
          Math.min(getAheadSourceTicks(clip, nowSourceTicks, speed), sourceRangeEndTicks) /
          TICKS_PER_SECOND,
        rangeEndSourceTimeS: sourceRangeEndTicks / TICKS_PER_SECOND,
        // Timeline slot of `nowSourceTicks` (for scrub-locality eviction): the
        // playhead for active clips, the clip start for not-yet-entered ones.
        timelineNowTicks: Math.max(nowTicks, clip.startTicks),
        speed,
      });
    }

    for (const owner of this.clips) {
      const transitionIn = owner.transitionIn;
      if (
        transitionIn &&
        (transitionIn.mode ?? DEFAULT_TRANSITION_MODE) === 'adjacent' &&
        transitionIn.durationTicks > 0 &&
        owner.startTicks <= nowTicks + headHorizonTicks &&
        owner.startTicks + transitionIn.durationTicks > nowTicks
      ) {
        const peer = this.findPrevClipOnLayer(owner);
        const speed = peer ? normalizeClipSpeed(peer.speed) : -1;
        if (peer?.sink && peer.clipKind === 'video' && speed > 0) {
          const transitionTimeTicks = Math.max(nowTicks, owner.startTicks);
          const sourceRangeEndTicks = peer.sourceStartTicks + peer.sourceRangeDurationTicks;
          const sourceDurationTicks = Math.max(sourceRangeEndTicks, peer.sourceDurationTicks || 0);
          const sourceTicks = Math.min(
            Math.max(0, sourceDurationTicks - TICKS_PER_MILLISECOND),
            sourceRangeEndTicks + Math.round((transitionTimeTicks - owner.startTicks) * speed),
          );
          // Warm the ENTIRE trailing handle the transition will read — from the
          // range end forward to the frame shown at the transition's last tick —
          // not just the default 16-frame look-ahead. A cross-cut reads a fresh
          // handle frame every rendered frame; if a slow transition render starves
          // the next 250 ms prewarm tick, the read overtakes a 16-frame frontier
          // and pays a from-keyframe random decode (measured ~0.5 s on long-GOP
          // sources) mid-transition. The handle is bounded by the transition
          // length, so decoding it whole up-front is cheap and sequential.
          const handleEndTicks = Math.min(
            Math.max(0, sourceDurationTicks - TICKS_PER_MILLISECOND),
            sourceRangeEndTicks + Math.round(transitionIn.durationTicks * speed),
          );
          addPlan({
            clip: peer,
            nowSourceTimeS: sourceTicks / TICKS_PER_SECOND,
            aheadSourceTimeS:
              Math.min(
                Math.max(getAheadSourceTicks(peer, sourceTicks, speed), handleEndTicks),
                sourceDurationTicks,
              ) / TICKS_PER_SECOND,
            rangeEndSourceTimeS: sourceDurationTicks / TICKS_PER_SECOND,
            timelineNowTicks: transitionTimeTicks,
            speed,
          });
        }
      }

      const transitionOut = owner.transitionOut;
      const transitionOutStartTicks = owner.endTicks - (transitionOut?.durationTicks ?? 0);
      if (
        transitionOut &&
        (transitionOut.mode ?? DEFAULT_TRANSITION_MODE) === 'adjacent' &&
        transitionOut.durationTicks > 0 &&
        transitionOutStartTicks <= nowTicks + headHorizonTicks &&
        owner.endTicks > nowTicks
      ) {
        const peer = this.findNextClipOnLayer(owner);
        const speed = peer ? normalizeClipSpeed(peer.speed) : -1;
        if (peer?.sink && peer.clipKind === 'video' && speed > 0) {
          const transitionTimeTicks = Math.max(nowTicks, transitionOutStartTicks);
          const remainingTicks = Math.max(0, owner.endTicks - transitionTimeTicks);
          const sourceTicks = Math.max(
            0,
            peer.sourceStartTicks - Math.round(remainingTicks * speed),
          );
          const sourceRangeEndTicks = peer.sourceStartTicks + peer.sourceRangeDurationTicks;
          // Warm the ENTIRE leading handle the transition will read — from the
          // current handle position forward to the clip's in-point reached at the
          // transition's last tick, plus a short in-clip lead for the crossover —
          // not just the default 16-frame look-ahead. See the transitionIn note:
          // a starved prewarm tick otherwise lets the per-frame handle read
          // overtake the frontier into a ~0.5 s random decode mid-transition.
          const handleEndTicks = Math.min(
            sourceRangeEndTicks,
            getAheadSourceTicks(peer, peer.sourceStartTicks, speed),
          );
          addPlan({
            clip: peer,
            nowSourceTimeS: sourceTicks / TICKS_PER_SECOND,
            aheadSourceTimeS:
              Math.min(
                Math.max(getAheadSourceTicks(peer, sourceTicks, speed), handleEndTicks),
                sourceRangeEndTicks,
              ) / TICKS_PER_SECOND,
            rangeEndSourceTimeS: sourceRangeEndTicks / TICKS_PER_SECOND,
            timelineNowTicks: transitionTimeTicks,
            speed,
          });
        }
      }
    }

    // Nearest-first (active clips share the smallest key) then bound concurrent
    // decoders when a dense cut cluster — e.g. a flattened nested timeline — packs
    // many short clips into the head horizon.
    const plans = [...plansByClipId.values()];
    plans.sort((a, b) => a.timelineNowTicks - b.timelineNowTicks);
    return plans.slice(0, Math.max(1, Math.round(VIDEO_CORE_LIMITS.MAX_PREWARM_CLIPS)));
  }

  // Video clip ids that were active at the previous render + the playhead time of
  // that check — used to detect a cut crossed while moving forward, for proactive
  // prewarm.
  private lastActiveVideoClipIds = new Set<string>();
  private lastClipEntryCheckTimeTicks = -1;

  /**
   * The instant a video clip enters the active set while moving forward (a cut
   * crossed during playback, or a forward jump), top up its decode-ahead window
   * immediately instead of waiting for the main thread's next ~250 ms prewarm
   * tick. Fire-and-forget: queues behind the settling render on the exclusive op.
   * Backward motion is ignored — scrubbing churns the active set and has its own
   * prewarm path. Complements the head-window warm in
   * {@link buildActiveClipWarmPlans}: that pre-warms while the clip is upcoming;
   * this covers a forward jump that skipped the upcoming phase.
   */
  private maybeProactivePrewarmOnClipEntry(timeTicks: number): void {
    const movingForward = timeTicks >= this.lastClipEntryCheckTimeTicks;
    this.lastClipEntryCheckTimeTicks = timeTicks;

    const activeVideoIds = new Set<string>();
    let entered = false;
    for (const clip of this.activeTracker.getActiveClips()) {
      if (clip.clipKind !== 'video' || typeof clip.freezeFrameSourceTicks === 'number') continue;
      activeVideoIds.add(clip.itemId);
      if (!this.lastActiveVideoClipIds.has(clip.itemId)) entered = true;
    }
    this.lastActiveVideoClipIds = activeVideoIds;

    if (!entered || !movingForward || this.disposed) return;
    void this.prewarmVideoFrames(timeTicks).catch(() => undefined);
  }

  private async prewarmVideoFramesLocked(
    timeTicks: number,
    lookaheadTicks: number,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    if (abortSignal?.aborted) return;
    const startTicks = Math.max(0, Math.round(timeTicks));
    this.videoFrameCache.setPriorityTimeTicks(startTicks);
    const endTicks = startTicks + Math.max(0, Math.round(lookaheadTicks));

    // Clips within the head horizon get a full head-window decode-ahead below
    // (buildActiveClipWarmPlans); the single-frame warm here covers the FARTHER
    // upcoming clips (head-horizon..lookahead) so their first displayed frame is
    // warm at the cut without opening a decoder for every distant clip.
    const activeWarmPlans = this.buildActiveClipWarmPlans(startTicks);
    const headWarmedIds = new Set(activeWarmPlans.map((plan) => plan.clip.itemId));
    const upcoming = this.clips
      .filter(
        (clip) =>
          clip.clipKind === 'video' &&
          Boolean(clip.sink) &&
          clip.startTicks > startTicks &&
          clip.startTicks <= endTicks &&
          !headWarmedIds.has(clip.itemId),
      )
      .sort((a, b) => a.startTicks - b.startTicks)
      .slice(0, Math.max(1, Math.round(VIDEO_CORE_LIMITS.MAX_PREWARM_CLIPS)));

    // Decode-ahead of the clips under (or imminently ahead of) the playhead via
    // persistent sequential iterators (each packet decoded once, no per-tick
    // keyframe re-seek) so the render path reads warm frames from the cache
    // instead of paying a from-keyframe `getSample` decode per displayed frame —
    // the fix for playback running at a fraction of real-time fps, extended to
    // the head of imminent clips so cuts don't stutter. Kept in this exclusive op
    // so the sequential read can never collide with the render path's own read of
    // the same sink. Streams of clips outside the warm set are pruned so their
    // decoders don't linger.
    this.clipResourceManager.pruneWarmStreams(headWarmedIds);

    await Promise.all([
      ...upcoming.map(async (clip) => {
        if (abortSignal?.aborted) return;
        const sampleTimeTicks =
          typeof clip.freezeFrameSourceTicks === 'number'
            ? Math.max(0, clip.freezeFrameSourceTicks)
            : resolveClipSourceTimeTicks({
                localTimeTicks: 0,
                sourceStartTicks: clip.sourceStartTicks,
                sourceRangeDurationTicks: clip.sourceRangeDurationTicks,
                speed: normalizeClipSpeed(clip.speed),
                frameRate: clip.frameRate,
              });

        const sample = await this.getVideoSampleForClip({
          clip,
          sampleTimeS: sampleTimeTicks / TICKS_PER_SECOND,
          timelineTimeTicks: clip.startTicks,
          abortSignal,
        });
        // This warm request only populates the frame cache. Unlike a render
        // request, no sprite consumes its owned clone.
        try {
          (sample as { close?: () => void } | null)?.close?.();
        } catch {
          // A failed cleanup must not cancel the rest of the prewarm batch.
        }
      }),
      ...activeWarmPlans.map((plan) =>
        this.clipResourceManager
          .warmClipFrameWindow({ ...plan, abortSignal })
          .catch(() => undefined),
      ),
    ]);
  }

  private updateTimelineLayoutLocked(timelineClips: ReadonlyArray<WorkerVideoPayloadItem>): number {
    const meta = timelineClips.find((x) => x && typeof x === 'object' && x.kind === 'meta');
    const nextMaster = meta
      ? (this.toVideoEffects((meta as { masterEffects?: unknown }).masterEffects) ?? null)
      : null;
    this.masterEffects = nextMaster;

    this.trackRuntimeManager.sync(timelineClips, this.app);

    const updated = this.timelineLayoutOrchestrator.apply({
      clips: this.clips,
      timelineClips,
      clipLayoutUpdater: this.timelineClipLayoutUpdater,
      trackRebinder: this.timelineTrackRebinder,
      updateLifecycle: this.timelineUpdateLifecycle,
      getFallbackTrackId: ({ clip, next }) =>
        this.getTrackRuntimeForClip({
          layer: Math.round(Number((next as { layer?: number }).layer ?? clip.layer ?? 0)),
        })?.id,
      getTrackRuntimeForClip: (clip) => this.getTrackRuntimeForClip(clip),
      toVideoEffects: (value) => this.toVideoEffects(value),
      applyClipLayoutForCurrentSource: (clip) =>
        this.layoutApplier.applyClipLayoutForCurrentSource(clip),
      clearClipTransitionFilter: (clip) => this.transitionManager.clearClipFilter(clip),
    });

    this.clips = updated.clips;
    this.rebuildPrevClipIndex();
    this.maxDurationTicks = updated.maxDurationTicks;
    this.lastRenderedTimeTicks = updated.lastRenderedTimeTicks;
    this.activeTracker.reset();
    this.hideAllClipSprites();
    this.stageSortDirty = updated.stageSortDirty;
    this.activeSortDirty = updated.activeSortDirty;
    return this.maxDurationTicks;
  }

  async renderFrame(
    timeTicks: number,
    options?: PreviewRenderOptions,
  ): Promise<OffscreenCanvas | HTMLCanvasElement | null> {
    if (this.disposed || !this.app || !this.canvas) return null;
    if (
      this.previewEffectsEnabled &&
      !this.computeRunner.isReady() &&
      !this.computeUnavailableWarningShown &&
      (this.masterEffects?.length ||
        this.clips.some((clip) => clip.effects?.length) ||
        this.tracks.some((track) => track.effects?.length))
    ) {
      this.computeUnavailableWarningShown = true;
      log.error(
        'WebGPU compute is unavailable; video effects and shader transitions cannot be rendered.',
      );
    }
    // Capture into locals: the guard's narrowing of the mutable this.app/
    // this.canvas does not survive into the runExclusive closure below.
    const app = this.app;
    const canvas = this.canvas;
    const stageTextureRenderer = this.ensureStageTextureRenderer(app);

    // Render holds an exclusive queue slot for its full async lifetime (decode +
    // shader transitions + GPU upload). updateTimelineLayout / loadTimeline /
    // clearClips run on the same queue, so a mutation can never dispose a
    // VideoFrame or sink mid-render — it waits for the in-flight render to settle
    // first (and vice versa).
    return this.runExclusive((signal) => {
      this.videoFrameCache.setPriorityTimeTicks(timeTicks);
      // If the queue watchdog trips, abort in-flight sample reads so a stalled
      // render unwinds and stops blocking queued edits.
      if (signal.aborted) this.resourceManager.abortInFlight();
      else
        signal.addEventListener('abort', () => this.resourceManager.abortInFlight(), {
          once: true,
        });
      const context = this.renderContextBuilder.build({
        app,
        canvas,
        state: {
          width: this.width,
          height: this.height,
          clips: this.clips,
          lastRenderedTimeTicks: this.lastRenderedTimeTicks,
          stageSortDirty: this.stageSortDirty,
          activeSortDirty: this.activeSortDirty,
          contextLost: this.contextLost,
          previewEffectsEnabled: this.previewEffectsEnabled,
          previewEffectQuality: this.previewEffectQuality,
          masterEffects: this.masterEffects,
        },
        activeTrackerUpdate: (currentTimeTicks, lastTimeTicks) =>
          this.activeTracker.update({
            clips: this.clips,
            timeTicks: currentTimeTicks,
            lastTimeTicks,
            onDeactivate: (clip) => {
              if (clip.sprite && !clip.sprite.destroyed) {
                clip.sprite.visible = false;
              }
            },
          }),
        hideInactiveClipSprites: (activeClips) => this.hideInactiveClipSprites(activeClips),
        prepareAdjustmentClips: (activeClips) => this.prepareAdjustmentClips(activeClips),
        getVideoSampleForClip: (params) => this.getVideoSampleForClip(params),
        getClipById: (clipId) => this.clipById.get(clipId),
        getPrevClipOnLayer: (clip) => this.findPrevClipOnLayer(clip),
        getNextClipOnLayer: (clip) => this.findNextClipOnLayer(clip),
        setClipSpriteVisible: (clip, visible) => this.setClipSpriteVisible(clip, visible),
        getPreviewEffectsEnabled: () => this.previewEffectsEnabled,
        setPreviewEffectsEnabled: (enabled) => {
          this.previewEffectsEnabled = enabled;
        },
        setPreviewEffectQuality: (quality) => {
          this.previewEffectQuality = quality;
          this.computeRunner.setPreviewEffectQuality(quality);
        },
        setStageSortDirty: (value) => {
          this.stageSortDirty = value;
        },
        setActiveSortDirty: (value) => {
          this.activeSortDirty = value;
        },
        setLastRenderedTimeTicks: (value) => {
          this.lastRenderedTimeTicks = value;
        },
        resourceManager: this.resourceManager,
        videoFrameCache: this.videoFrameCache,
        effectManager: this.effectManager,
        transitionManager: this.transitionManager,
        clipResourceManager: this.clipResourceManager,
        transitionRenderer: this.transitionRenderer,
        stageTextureRenderer,
        stageManager: this.stageManager,
        frameSampleOrchestrator: this.frameSampleOrchestrator,
        timelineActiveClipProcessor: this.timelineActiveClipProcessor,
        canvasFallbackRenderer: this.canvasFallbackRenderer,
        shapeRenderer: this.shapeRenderer,
        textRenderer: this.textRenderer,
        layoutApplier: this.layoutApplier,
        trackRuntimeManager: this.trackRuntimeManager,
        masterEffectFilters: this.masterEffectFilters,
      });
      const renderStartMs = performance.now();
      return this.renderingEngine.renderFrame(timeTicks, options, context).finally(() => {
        compositorPerfStats.onRender(performance.now() - renderStartMs);
        this.maybeProactivePrewarmOnClipEntry(timeTicks);
      });
    }, 'renderFrame');
  }

  private findPrevClipOnLayer(clip: CompositorClip): CompositorClip | null {
    const best = this.prevClipById.get(clip.itemId) ?? null;
    if (!best) return null;
    if (clip.startTicks - best.endTicks > VIDEO_CORE_LIMITS.BLEND_SHADOW_GAP_THRESHOLD_TICKS)
      return null;
    return best;
  }

  private findNextClipOnLayer(clip: CompositorClip): CompositorClip | null {
    const best = this.nextClipById.get(clip.itemId) ?? null;
    if (!best) return null;
    if (best.startTicks - clip.endTicks > VIDEO_CORE_LIMITS.BLEND_SHADOW_GAP_THRESHOLD_TICKS)
      return null;
    return best;
  }

  private renderLowerLayersToTexture(layer: number, texture: RenderTexture) {
    this.stageTextureRenderer?.renderLowerLayersToTexture(layer, texture);
  }

  private getActiveTransitionState(clip: CompositorClip, timeTicks: number) {
    return this.transitionManager.getActiveTransitionState(
      clip,
      timeTicks,
      this.previewEffectsEnabled,
    );
  }

  private async updateClipTextureFromSample(sample: unknown, clip: CompositorClip) {
    await this.clipResourceManager.updateClipTextureFromSample(sample, clip);
  }

  clearClips(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    return this.runExclusive(() => this.clearClipsLocked(), 'clearClips');
  }

  private clearClipsLocked() {
    this.videoFrameCache.clear();
    this.transitionManager.clear();
    for (const clip of this.clips) {
      this.destroyClip(clip);
    }
    this.trackRuntimeManager.clear();
    this.clips = [];
    this.clipById.clear();
    this.prevClipById.clear();
    this.nextClipById.clear();
    this.replacedClipIds.clear();
    this.clipPreferBitmapFallback.clear();
    this.lastRenderedTimeTicks = 0;
    this.activeTracker.reset();
    this.stageSortDirty = true;
    this.activeSortDirty = true;
    this.maxDurationTicks = 0;
  }

  async destroy() {
    // Mark disposed first so any late renderFrame/updateTimelineLayout/clearClips
    // RPC bails instead of touching resources we are about to free.
    this.disposed = true;
    // Drain the queue so we never tear down pixi while an in-flight render is
    // still reading a sink or uploading a VideoFrame. The watchdog guarantees
    // the in-flight op settles in bounded time, so this can't hang teardown.
    await this.opQueue.drain();
    // Terminal teardown: run the clear synchronously (not through the queue) so
    // pixi resources are gone before we dispose the renderer below.
    this.clearClipsLocked();
    this.videoFrameCache.clear();
    this.transitionRenderer.destroy();
    // Clean up cached adjustment blit resources.
    if (this.adjustmentBlitSprite) {
      const tex = this.adjustmentBlitSprite.texture;
      this.adjustmentBlitSprite.destroy();
      tex?.destroy(true);
      this.adjustmentBlitSprite = null;
    }
    this.adjustmentBlitSource = null;
    if (this.stageTextureRenderer) {
      this.stageTextureRenderer.destroy();
      this.stageTextureRenderer = null;
    }
    this.pixiLifecycle.destroy({
      app: this.app,
      canvas: this.canvas,
      onContextLost: this.onContextLost,
      onContextRestored: this.onContextRestored,
      onDestroyError: (err) => {
        log.error('Application destroy failed', err);
      },
    });
    this.computeRunner.destroy();
    this.app = null;
    this.canvas = null;
  }

  private destroyClip(clip: CompositorClip) {
    this.clipResourceManager.destroyClip(clip, { transitionManager: this.transitionManager });
  }
}
