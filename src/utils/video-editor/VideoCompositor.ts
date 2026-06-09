import { createDevLogger } from '~/utils/dev-logger';
import { TimelineActiveTracker } from './TimelineActiveTracker';
import { Texture } from 'pixi.js';
import type { Application, Filter, RenderTexture } from 'pixi.js';
import type { WorkerVideoPayloadItem } from '../../composables/timeline/export/types';
import type { PreviewRenderOptions } from './worker-rpc';
import { VIDEO_CORE_LIMITS } from '../constants';
import type { VideoClipEffect } from '~/timeline/types';
import type { VectorImageRasterCacheResult } from './worker-client';

// Internal modules
import type { CompositorClip, CompositorTrack } from './compositor/types';
import { ResourceManager } from './compositor/ResourceManager';
import { VideoFrameCache } from './compositor/VideoFrameCache';
import { EffectManager } from './compositor/EffectManager';
import { TransitionManager } from './compositor/TransitionManager';
import type { LayoutApplier } from './compositor/LayoutApplier';
import type { ClipResourceManager } from './compositor/ClipResourceManager';
import { StageTextureRenderer } from './compositor/StageTextureRenderer';
import type { ClipFactory } from './compositor/ClipFactory';
import type { TimelineClipLoader } from './compositor/TimelineClipLoader';
import type { HudMediaLoader } from './compositor/HudMediaLoader';
import type { MediaClipLoader } from './compositor/MediaClipLoader';
import type { RasterImageLoader } from './compositor/RasterImageLoader';
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
import { CompositorOperationQueue } from './compositor/CompositorOperationQueue';
import { resetCompositorClipsAfterContextRestored } from './compositor/contextRestore';
import { TrackRuntimeManager } from './compositor/TrackRuntimeManager';
import { createCompositorRuntime } from './compositor/CompositorRuntimeFactory';
import { CompositorRenderContextBuilder } from './compositor/CompositorRenderContextBuilder';
import { PixiCompositorLifecycle } from './compositor/PixiCompositorLifecycle';
import { WebGpuComputeRunner } from './compositor/WebGpuComputeRunner';
const log = createDevLogger('VideoCompositor');

export interface VideoCompositorInitOptions {
  rendererPreference?: 'webgl' | 'webgpu';
}

export class VideoCompositor {
  public app: Application | null = null;
  public canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  public clips: CompositorClip[] = [];
  public maxDurationUs = 0;

  private width = 1920;
  private height = 1080;
  private clipById = new Map<string, CompositorClip>();
  private prevClipById = new Map<string, CompositorClip | null>();
  private nextClipById = new Map<string, CompositorClip | null>();
  private replacedClipIds = new Set<string>();
  private lastRenderedTimeUs = 0;
  private contextLost = false;
  private previewEffectsEnabled = true;

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
    getStartUs: (clip) => clip.startUs,
    getEndUs: (clip) => clip.endUs,
  });

  constructor() {
    this.resetRuntimeDependencies();
  }

  public async initComputeRunner(): Promise<boolean> {
    return this.computeRunner.init();
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
      clipPreferBitmapFallback: this.clipPreferBitmapFallback,
      resourceManager: this.resourceManager,
      videoFrameCache: this.videoFrameCache,
      computeRunner: this.computeRunner,
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

  private prepareAdjustmentClips(active: CompositorClip[]) {
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
        (a, b) => a.layer - b.layer || a.startUs - b.startUs || a.itemId.localeCompare(b.itemId),
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

    for (const clip of adjustmentClips) {
      clip.adjustmentSourceTexture = this.ensureClipRenderTexture(
        clip.adjustmentSourceTexture ?? null,
      );
      this.renderLowerLayersToTexture(clip.layer, clip.adjustmentSourceTexture);
      if (clip.sprite) clip.sprite.texture = clip.adjustmentSourceTexture;
    }
  }

  private async getVideoSampleForClip(params: {
    clip: CompositorClip;
    sampleTimeS: number;
    abortSignal?: AbortSignal;
  }): Promise<unknown | null> {
    return this.clipResourceManager.getVideoSampleForClip(params);
  }

  private toVideoEffects(value: unknown): VideoClipEffect[] | undefined {
    if (!Array.isArray(value)) return undefined;

    return value.filter((effect): effect is VideoClipEffect => {
      if (!effect || typeof effect !== 'object') return false;
      if (
        typeof (effect as { id?: string }).id !== 'string' ||
        !(effect as { id?: string }).id?.length
      )
        return false;
      if (
        typeof (effect as { type?: string }).type !== 'string' ||
        !(effect as { type?: string }).type?.length
      )
        return false;

      return (effect as { target?: string }).target !== 'audio';
    });
  }

  public buildTrackRuntimeList(timelineItems: unknown[]) {
    return this.trackRuntimeManager.buildList(timelineItems);
  }

  public async applyShaderTransitions(activeClips: CompositorClip[], currentTimeUs: number) {
    if (!this.app) return;

    const self = this as unknown as {
      renderSingleClipToTexture?: (
        clip: CompositorClip,
        texture: RenderTexture,
        clear?: boolean,
      ) => void;
      renderLowerLayersToTexture?: (layer: number, texture: RenderTexture) => void;
      ensureTransitionSprite?: (clip: CompositorClip) => void;
    };
    const stageTextureRenderer = this.stageTextureRenderer ?? {
      renderSingleClipToTexture: (clip: CompositorClip, texture: RenderTexture, clear?: boolean) =>
        self.renderSingleClipToTexture?.(clip, texture, clear),
      renderLowerLayersToTexture: (layer: number, texture: RenderTexture) =>
        self.renderLowerLayersToTexture?.(layer, texture),
      ensureTransitionSprite: (clip: CompositorClip) => self.ensureTransitionSprite?.(clip),
    };

    await this.transitionRenderer.applyShaderTransitions(activeClips, currentTimeUs, {
      app: this.app,
      clips: this.clips,
      width: this.width,
      height: this.height,
      transitionManager: this.transitionManager,
      stageTextureRenderer:
        stageTextureRenderer as import('./compositor/StageTextureRenderer').StageTextureRenderer,
      getTrackById: (trackId) => this.trackRuntimeManager.getById(trackId),
      getActiveTransitionState: (clip, timeUs) =>
        this.getActiveTransitionState(clip, timeUs) as {
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
    startUs: number;
    requestedTimelineDurationUs: number;
    sequentialTimeUs: number;
  }) {
    const endUs = params.startUs + Math.max(0, params.requestedTimelineDurationUs);
    return {
      endUs,
      sequentialTimeUs: Math.max(params.sequentialTimeUs, endUs),
    };
  }

  private applyLoadedTimeline(params: {
    nextClips: CompositorClip[];
    nextClipById: Map<string, CompositorClip>;
    sequentialTimeUs: number;
  }) {
    const applied = this.timelineApplyLifecycle.apply({
      previousClipById: this.clipById,
      replacedClipIds: this.replacedClipIds,
      nextClips: params.nextClips,
      nextClipById: params.nextClipById,
      sequentialTimeUs: params.sequentialTimeUs,
      destroyClip: (clip) => this.destroyClip(clip),
    });

    this.clips = applied.clips;
    this.clipById = applied.clipById;
    this.rebuildPrevClipIndex();
    this.maxDurationUs = applied.maxDurationUs;
    this.lastRenderedTimeUs = applied.lastRenderedTimeUs;
    this.activeTracker.reset();
    this.hideAllClipSprites();
    this.stageSortDirty = applied.stageSortDirty;
    this.activeSortDirty = applied.activeSortDirty;

    return this.maxDurationUs;
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
    this.contextLost = false;
    this.resetRuntimeDependencies();

    // Initialize WebGPU compute runner lazily; failures are non-fatal.
    void this.computeRunner.init();

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

    this.ensureStageTextureRenderer(this.app);
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
  }

  async loadTimeline(
    timelineClips: ReadonlyArray<WorkerVideoPayloadItem>,
    deps: {
      getFileHandleByPath: (path: string) => Promise<FileSystemFileHandle | null>;
      getFileByPath?: (path: string) => Promise<File | null>;
      getCurrentProjectId?: () => Promise<string | null>;
      ensureVectorImageRaster?: (params: {
        projectId: string;
        projectRelativePath: string;
        width: number;
        height: number;
        sourceFileHandle: FileSystemFileHandle;
      }) => Promise<VectorImageRasterCacheResult | null>;
    },
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
  private runExclusive<T>(fn: (signal: AbortSignal) => Promise<T> | T, label = 'op'): Promise<T> {
    return this.opQueue.run(fn, label);
  }

  private async loadTimelineLocked(
    timelineClips: ReadonlyArray<WorkerVideoPayloadItem>,
    deps: {
      getFileHandleByPath: (path: string) => Promise<FileSystemFileHandle | null>;
      getFileByPath?: (path: string) => Promise<File | null>;
      getCurrentProjectId?: () => Promise<string | null>;
      ensureVectorImageRaster?: (params: {
        projectId: string;
        projectRelativePath: string;
        width: number;
        height: number;
        sourceFileHandle: FileSystemFileHandle;
      }) => Promise<VectorImageRasterCacheResult | null>;
    },
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
    const { nextClips, nextClipById, sequentialTimeUs } = await this.timelineLoadOrchestrator.load({
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
      sequentialTimeUs,
    });
  }

  updateTimelineLayout(timelineClips: ReadonlyArray<WorkerVideoPayloadItem>): Promise<number> {
    if (this.disposed) return Promise.resolve(this.maxDurationUs);
    return this.runExclusive(
      () => this.updateTimelineLayoutLocked(timelineClips),
      'updateTimelineLayout',
    );
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
    this.maxDurationUs = updated.maxDurationUs;
    this.lastRenderedTimeUs = updated.lastRenderedTimeUs;
    this.activeTracker.reset();
    this.hideAllClipSprites();
    this.stageSortDirty = updated.stageSortDirty;
    this.activeSortDirty = updated.activeSortDirty;
    return this.maxDurationUs;
  }

  async renderFrame(
    timeUs: number,
    options?: PreviewRenderOptions,
  ): Promise<OffscreenCanvas | HTMLCanvasElement | null> {
    if (this.disposed || !this.app || !this.canvas) return null;
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
          lastRenderedTimeUs: this.lastRenderedTimeUs,
          stageSortDirty: this.stageSortDirty,
          activeSortDirty: this.activeSortDirty,
          contextLost: this.contextLost,
          previewEffectsEnabled: this.previewEffectsEnabled,
          masterEffects: this.masterEffects,
        },
        activeTrackerUpdate: (currentTimeUs, lastTimeUs) =>
          this.activeTracker.update({
            clips: this.clips,
            timeUs: currentTimeUs,
            lastTimeUs,
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
        setStageSortDirty: (value) => {
          this.stageSortDirty = value;
        },
        setActiveSortDirty: (value) => {
          this.activeSortDirty = value;
        },
        setLastRenderedTimeUs: (value) => {
          this.lastRenderedTimeUs = value;
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
      return this.renderingEngine.renderFrame(timeUs, options, context);
    }, 'renderFrame');
  }

  private findPrevClipOnLayer(clip: CompositorClip): CompositorClip | null {
    const best = this.prevClipById.get(clip.itemId) ?? null;
    if (!best) return null;
    if (clip.startUs - best.endUs > VIDEO_CORE_LIMITS.BLEND_SHADOW_GAP_THRESHOLD_US) return null;
    return best;
  }

  private findNextClipOnLayer(clip: CompositorClip): CompositorClip | null {
    const best = this.nextClipById.get(clip.itemId) ?? null;
    if (!best) return null;
    if (best.startUs - clip.endUs > VIDEO_CORE_LIMITS.BLEND_SHADOW_GAP_THRESHOLD_US) return null;
    return best;
  }

  private renderLowerLayersToTexture(layer: number, texture: RenderTexture) {
    this.stageTextureRenderer?.renderLowerLayersToTexture(layer, texture);
  }

  private getActiveTransitionState(clip: CompositorClip, timeUs: number) {
    return this.transitionManager.getActiveTransitionState(
      clip,
      timeUs,
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
    this.lastRenderedTimeUs = 0;
    this.activeTracker.reset();
    this.stageSortDirty = true;
    this.activeSortDirty = true;
    this.maxDurationUs = 0;
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
    this.app = null;
    this.canvas = null;
  }

  private destroyClip(clip: CompositorClip) {
    this.clipResourceManager.destroyClip(clip, { transitionManager: this.transitionManager });
  }
}
