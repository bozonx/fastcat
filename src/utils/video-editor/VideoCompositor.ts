import { safeDispose } from './utils';
import { TimelineActiveTracker } from './TimelineActiveTracker';
import {
  Application,
  DOMAdapter,
  WebWorkerAdapter,
  RenderTexture,
  Texture,
  Container,
} from 'pixi.js';
import type { Filter } from 'pixi.js';
import type { WorkerTimelineClip } from '../../composables/monitor/types';
import type { PreviewRenderOptions } from './worker-rpc';
import { VIDEO_CORE_LIMITS } from '../constants';
import type {
  TextClipStyle,
  ClipTransform,
  ClipTransition,
  VideoClipEffect,
} from '~/timeline/types';

// Internal modules
import { type CompositorClip, type CompositorTrack, type HudMediaState } from './compositor/types';
import { ResourceManager } from './compositor/ResourceManager';
import { VideoFrameCache } from './compositor/VideoFrameCache';
import { EffectManager } from './compositor/EffectManager';
import { TransitionManager } from './compositor/TransitionManager';
import { LayoutApplier } from './compositor/LayoutApplier';
import { ClipResourceManager } from './compositor/ClipResourceManager';
import { StageTextureRenderer } from './compositor/StageTextureRenderer';
import { ClipFactory } from './compositor/ClipFactory';
import { TimelineClipLoader } from './compositor/TimelineClipLoader';
import { HudMediaLoader } from './compositor/HudMediaLoader';
import { MediaClipLoader } from './compositor/MediaClipLoader';
import { RasterImageLoader } from './compositor/RasterImageLoader';
import { TimelineApplyLifecycle } from './compositor/TimelineApplyLifecycle';
import { TimelineClipLayoutUpdater } from './compositor/TimelineClipLayoutUpdater';
import { TimelineFixedClipBuilder } from './compositor/TimelineFixedClipBuilder';
import { TimelineLoadOrchestrator } from './compositor/TimelineLoadOrchestrator';
import { TimelineMediaClipBuilder } from './compositor/TimelineMediaClipBuilder';
import { TimelineActiveClipProcessor } from './compositor/TimelineActiveClipProcessor';
import { TimelineTrackRebinder } from './compositor/TimelineTrackRebinder';
import { TimelineUpdateLifecycle } from './compositor/TimelineUpdateLifecycle';
import { TimelineLayoutOrchestrator } from './compositor/TimelineLayoutOrchestrator';
import { TextRenderer } from './compositor/renderers/TextRenderer';
import { ShapeRenderer } from './compositor/renderers/ShapeRenderer';
import { CanvasFallbackRenderer } from './compositor/renderers/CanvasFallbackRenderer';
import { buildPrevClipByIdIndex, buildTrackRuntimeList } from './compositor/trackRuntime';
import { RenderingEngine } from './compositor/RenderingEngine';
import { FrameSampleOrchestrator } from './compositor/FrameSampleOrchestrator';
import { StageManager } from './compositor/StageManager';
import { TransitionRenderer } from './compositor/TransitionRenderer';

export class VideoCompositor {
  public app: Application | null = null;
  public canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  public clips: CompositorClip[] = [];
  public maxDurationUs = 0;

  private width = 1920;
  private height = 1080;
  private clipById = new Map<string, CompositorClip>();
  private prevClipById = new Map<string, CompositorClip | null>();
  private trackById = new Map<string, CompositorTrack>();
  private trackByLayer = new Map<number, CompositorTrack>();
  private tracks: CompositorTrack[] = [];
  private replacedClipIds = new Set<string>();
  private lastRenderedTimeUs = 0;
  private contextLost = false;
  private previewEffectsEnabled = true;

  private masterEffects: VideoClipEffect[] | null = null;
  private masterEffectFilters = new Map<string, Filter>();
  private stageSortDirty = true;
  private activeSortDirty = true;
  private clipPreferBitmapFallback = new Map<string, boolean>();
  private videoFrameCache = new VideoFrameCache(
    Math.max(0, Number(VIDEO_CORE_LIMITS.MAX_VIDEO_FRAME_CACHE_MB) || 0) * 1024 * 1024,
  );

  // Managers
  private resourceManager = new ResourceManager();
  private effectManager = new EffectManager();
  private transitionManager = new TransitionManager();
  private layoutApplier = new LayoutApplier({ width: this.width, height: this.height });

  // Renderers
  private textRenderer = new TextRenderer();
  private shapeRenderer = new ShapeRenderer();
  private canvasFallbackRenderer = new CanvasFallbackRenderer({
    width: this.width,
    height: this.height,
    layoutApplier: this.layoutApplier,
    clipPreferBitmapFallback: this.clipPreferBitmapFallback,
  });
  private timelineClipLoader = new TimelineClipLoader();
  private hudMediaLoader = new HudMediaLoader({
    width: this.width,
    height: this.height,
  });
  private mediaClipLoader = new MediaClipLoader();
  private rasterImageLoader = new RasterImageLoader({
    width: this.width,
    height: this.height,
  });
  private clipFactory = new ClipFactory({
    width: this.width,
    height: this.height,
    layoutApplier: this.layoutApplier,
  });
  private timelineFixedClipBuilder = new TimelineFixedClipBuilder({
    clipFactory: this.clipFactory,
    hudMediaLoader: this.hudMediaLoader,
  });
  private timelineMediaClipBuilder = new TimelineMediaClipBuilder({
    clipFactory: this.clipFactory,
    layoutApplier: this.layoutApplier,
  });
  private timelineLoadOrchestrator = new TimelineLoadOrchestrator({
    timelineClipLoader: this.timelineClipLoader,
    timelineFixedClipBuilder: this.timelineFixedClipBuilder,
    timelineMediaClipBuilder: this.timelineMediaClipBuilder,
    mediaClipLoader: this.mediaClipLoader,
    rasterImageLoader: this.rasterImageLoader,
  });
  private timelineActiveClipProcessor = new TimelineActiveClipProcessor();
  private timelineApplyLifecycle = new TimelineApplyLifecycle();
  private timelineClipLayoutUpdater = new TimelineClipLayoutUpdater();
  private timelineTrackRebinder = new TimelineTrackRebinder();
  private timelineUpdateLifecycle = new TimelineUpdateLifecycle();
  private timelineLayoutOrchestrator = new TimelineLayoutOrchestrator();
  private renderingEngine = new RenderingEngine();
  private frameSampleOrchestrator = new FrameSampleOrchestrator();
  private stageManager = new StageManager();
  private transitionRenderer = new TransitionRenderer();
  private clipResourceManager = new ClipResourceManager({
    width: this.width,
    height: this.height,
    resourceManager: this.resourceManager,
    videoFrameCache: this.videoFrameCache,
    canvasFallbackRenderer: this.canvasFallbackRenderer,
    getLayoutApplier: () => this.layoutApplier,
  });
  private stageTextureRenderer: StageTextureRenderer | null = null;

  private readonly activeTracker = new TimelineActiveTracker<CompositorClip>({
    getId: (clip) => clip.itemId,
    getStartUs: (clip) => clip.startUs,
    getEndUs: (clip) => clip.endUs,
  });

  private ensureClipRenderTexture(texture: RenderTexture | null): RenderTexture {
    return this.clipResourceManager.ensureClipRenderTexture(texture);
  }

  private setClipSpriteVisible(clip: CompositorClip, visible: boolean) {
    if (!clip.sprite || (clip.sprite as any).destroyed) {
      return false;
    }

    clip.sprite.visible = visible;
    return true;
  }

  private prepareAdjustmentClips(active: CompositorClip[]) {
    if (!this.app?.renderer) return;

    const adjustmentClips = active
      .filter((clip) => clip.clipKind === 'adjustment' && clip.sprite.visible)
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
        } catch (e) {
          // ignore PixiJS internal errors on reset
        }
      }
    }

    for (const clip of adjustmentClips) {
      clip.adjustmentSourceTexture = this.ensureClipRenderTexture(
        clip.adjustmentSourceTexture ?? null,
      );
      this.renderLowerLayersToTexture(clip.layer, clip.adjustmentSourceTexture);
      clip.sprite.texture = clip.adjustmentSourceTexture;
    }
  }

  private async getVideoSampleForClip(params: {
    clip: CompositorClip;
    sampleTimeS: number;
    abortSignal?: AbortSignal;
  }): Promise<any | null> {
    return this.clipResourceManager.getVideoSampleForClip(params);
  }

  private toVideoEffects(value: unknown): VideoClipEffect[] | undefined {
    if (!Array.isArray(value)) return undefined;

    return value.filter((effect): effect is VideoClipEffect => {
      if (!effect || typeof effect !== 'object') return false;
      if (typeof (effect as any).id !== 'string' || (effect as any).id.length === 0) return false;
      if (typeof (effect as any).type !== 'string' || (effect as any).type.length === 0)
        return false;

      return (effect as any).target !== 'audio';
    });
  }

  public buildTrackRuntimeList(timelineItems: any[]) {
    return buildTrackRuntimeList(timelineItems, (value) => this.toVideoEffects(value));
  }

  public async applyShaderTransitions(activeClips: CompositorClip[], currentTimeUs: number) {
    if (!this.app) return;

    const self = this as any;
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
      stageTextureRenderer: stageTextureRenderer as any,
      getTrackById: (trackId) => this.trackById.get(trackId),
      getActiveTransitionState: (clip, timeUs) => this.getActiveTransitionState(clip, timeUs),
      ensureTransitionRenderTexture: (texture) =>
        this.clipResourceManager.ensureTransitionRenderTexture(texture),
      findPrevClipOnLayer: (clip) => this.findPrevClipOnLayer(clip),
      createAbortController: (key) => this.resourceManager.createAbortController(key),
      getVideoSampleForClip: (params) => this.getVideoSampleForClip(params),
      updateClipTextureFromSample: (sample, clip) => this.updateClipTextureFromSample(sample, clip),
    });
  }

  private syncTrackRuntimes(timelineItems: any[]) {
    if (!this.app) return;

    const nextDefs = buildTrackRuntimeList(timelineItems, (value) => this.toVideoEffects(value));
    const nextTrackById = new Map<string, CompositorTrack>();
    const nextTrackByLayer = new Map<number, CompositorTrack>();
    const nextTracks: CompositorTrack[] = [];

    for (const def of nextDefs) {
      const existing = this.trackById.get(def.id) ?? this.trackByLayer.get(def.layer);
      const track: CompositorTrack = existing ?? {
        id: def.id,
        layer: def.layer,
        container: new Container(),
      };

      track.id = def.id;
      track.layer = def.layer;
      track.opacity = def.opacity;
      track.blendMode = def.blendMode;
      track.effects = def.effects;
      track.container.alpha = def.opacity ?? 1;
      track.container.blendMode = def.blendMode ?? 'normal';
      (track.container as any).__trackId = def.id;

      if (track.container.parent !== this.app.stage) {
        this.app.stage.addChild(track.container);
      }

      nextTrackById.set(track.id, track);
      nextTrackByLayer.set(track.layer, track);
      nextTracks.push(track);
    }

    for (const [trackId, track] of this.trackById.entries()) {
      if (nextTrackById.has(trackId)) continue;
      if (track.container.parent) {
        track.container.parent.removeChild(track.container);
      }
      if (track.effectFilters) {
        for (const filter of track.effectFilters.values()) {
          try {
            (filter as any)?.destroy?.();
          } catch {
            // ignore
          }
        }
      }
    }

    this.trackById = nextTrackById;
    this.trackByLayer = nextTrackByLayer;
    this.tracks = nextTracks.sort((a, b) => a.layer - b.layer);
  }

  private getTrackRuntimeForClip(
    clip: Pick<CompositorClip, 'trackId' | 'layer'>,
  ): CompositorTrack | null {
    if (clip.trackId) {
      return this.trackById.get(clip.trackId) ?? this.trackByLayer.get(clip.layer) ?? null;
    }
    return this.trackByLayer.get(clip.layer) ?? null;
  }

  private rebuildPrevClipIndex() {
    this.prevClipById = buildPrevClipByIdIndex(this.clips);
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
      if (clip.sprite) {
        clip.sprite.visible = false;
      }
    }
  }

  async init(
    width: number,
    height: number,
    bgColor = '#000',
    offscreen = true,
    externalCanvas?: OffscreenCanvas | HTMLCanvasElement,
  ): Promise<void> {
    if (this.app) {
      try {
        this.destroy();
      } catch (err) {
        console.error('[VideoCompositor] Failed to destroy previous application instance', err);
        this.app = null;
      }
    }

    this.width = width;
    this.height = height;
    this.contextLost = false;
    this.layoutApplier = new LayoutApplier({ width: this.width, height: this.height });
    this.canvasFallbackRenderer = new CanvasFallbackRenderer({
      width: this.width,
      height: this.height,
      layoutApplier: this.layoutApplier,
      clipPreferBitmapFallback: this.clipPreferBitmapFallback,
    });
    this.timelineClipLoader = new TimelineClipLoader();
    this.hudMediaLoader = new HudMediaLoader({
      width: this.width,
      height: this.height,
    });
    this.mediaClipLoader = new MediaClipLoader();
    this.rasterImageLoader = new RasterImageLoader({
      width: this.width,
      height: this.height,
    });
    this.clipFactory = new ClipFactory({
      width: this.width,
      height: this.height,
      layoutApplier: this.layoutApplier,
    });
    this.timelineFixedClipBuilder = new TimelineFixedClipBuilder({
      clipFactory: this.clipFactory,
      hudMediaLoader: this.hudMediaLoader,
    });
    this.timelineMediaClipBuilder = new TimelineMediaClipBuilder({
      clipFactory: this.clipFactory,
      layoutApplier: this.layoutApplier,
    });
    this.timelineLoadOrchestrator = new TimelineLoadOrchestrator({
      timelineClipLoader: this.timelineClipLoader,
      timelineFixedClipBuilder: this.timelineFixedClipBuilder,
      timelineMediaClipBuilder: this.timelineMediaClipBuilder,
      mediaClipLoader: this.mediaClipLoader,
      rasterImageLoader: this.rasterImageLoader,
    });
    this.timelineActiveClipProcessor = new TimelineActiveClipProcessor();
    this.timelineApplyLifecycle = new TimelineApplyLifecycle();
    this.timelineClipLayoutUpdater = new TimelineClipLayoutUpdater();
    this.timelineTrackRebinder = new TimelineTrackRebinder();
    this.timelineUpdateLifecycle = new TimelineUpdateLifecycle();
    this.timelineLayoutOrchestrator = new TimelineLayoutOrchestrator();
    this.clipResourceManager = new ClipResourceManager({
      width: this.width,
      height: this.height,
      resourceManager: this.resourceManager,
      videoFrameCache: this.videoFrameCache,
      canvasFallbackRenderer: this.canvasFallbackRenderer,
      getLayoutApplier: () => this.layoutApplier,
    });

    if (typeof window === 'undefined') {
      DOMAdapter.set(WebWorkerAdapter);
    }

    this.app = new Application();

    if (externalCanvas) {
      this.canvas = externalCanvas;
    } else if (offscreen) {
      this.canvas = new OffscreenCanvas(width, height);
    } else {
      this.canvas = document.createElement('canvas');
      this.canvas.width = width;
      this.canvas.height = height;
    }

    if (this.canvas && 'addEventListener' in (this.canvas as any)) {
      (this.canvas as any).addEventListener('webglcontextlost', this.onContextLost, false);
      (this.canvas as any).addEventListener('webglcontextrestored', this.onContextRestored, false);
    }

    await this.app.init({
      width,
      height,
      canvas: this.canvas as any,
      backgroundColor: bgColor,
      preference: 'webgpu',
      clearBeforeRender: true,
    });

    // Stop the automatic ticker, we will render manually
    this.app.ticker.stop();
    this.stageTextureRenderer = new StageTextureRenderer({
      app: this.app,
      width: this.width,
      height: this.height,
      getTrackById: (trackId) => this.trackById.get(trackId),
    });
  }

  private onContextLost = (event: Event) => {
    event.preventDefault();
    console.warn('[VideoCompositor] WebGL/WebGPU context lost!');
    this.contextLost = true;
  };

  private onContextRestored = () => {
    console.warn('[VideoCompositor] WebGL/WebGPU context restored!');
    this.contextLost = false;
    this.stageSortDirty = true;
    this.videoFrameCache.clear();
    for (const clip of this.clips) {
      clip.textDirty = true;
      clip.shapeDirty = true;
      if (clip.lastVideoFrame) {
        safeDispose(clip.lastVideoFrame);
        clip.lastVideoFrame = null;
      }
      clip.canvas = null;
      if (clip.bitmap) {
        try {
          clip.bitmap.close();
        } catch {}
        clip.bitmap = null;
      }
      try {
        if (
          clip.imageSource?.resource &&
          typeof (clip.imageSource.resource as any).update === 'function'
        ) {
          (clip.imageSource.resource as any).update();
        }
      } catch {}
      if (clip.transitionFilter) {
        try {
          clip.transitionFilter.destroy();
        } catch {}
        clip.transitionFilter = null;
      }
      if (clip.adjustmentSourceTexture) {
        try {
          clip.adjustmentSourceTexture.destroy(true);
        } catch {}
        clip.adjustmentSourceTexture = null;
      }
    }
  };

  async loadTimeline(
    timelineClips: (WorkerTimelineClip | { kind: 'meta' | 'track'; [key: string]: any })[],
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
      }) => Promise<FileSystemFileHandle | null>;
    },
    checkCancel?: () => boolean,
  ): Promise<number> {
    if (!this.app) throw new Error('VideoCompositor not initialized');

    // Extract stage-level (master) effects from meta items.
    // We keep the payload format flexible since it comes from a worker boundary.
    const meta = timelineClips.find((x) => x && typeof x === 'object' && x.kind === 'meta');
    const nextMaster = meta ? (this.toVideoEffects((meta as any).masterEffects) ?? null) : null;
    this.masterEffects = nextMaster;
    this.syncTrackRuntimes(timelineClips);
    this.stageSortDirty = true;

    const { Input, BlobSource, VideoSampleSink, ALL_FORMATS } = await import('mediabunny');
    const { nextClips, nextClipById, sequentialTimeUs } = await this.timelineLoadOrchestrator.load({
      timelineClips,
      deps,
      mediabunny: {
        Input,
        BlobSource,
        VideoSampleSink,
        ALL_FORMATS,
      },
      callbacks: {
        checkCancel,
        destroyClip: (clip) => this.destroyClip(clip),
        getExistingClipById: (itemId) => this.clipById.get(itemId),
        getFallbackTrackId: (clipData) =>
          this.getTrackRuntimeForClip({ layer: Math.round(Number((clipData as any)?.layer ?? 0)) })
            ?.id ?? null,
        getTrackRuntimeForClip: (clip) => this.getTrackRuntimeForClip(clip),
        applySolidLayout: (clip) => this.layoutApplier.applySolidLayout(clip),
        replaceExistingClip: (params) => this.replaceExistingClip(params),
        resolveFixedClipEnd: (params) => this.resolveFixedClipEnd(params),
        registerLoadedClip: (params) => this.registerLoadedClip(params),
        toVideoEffects: (value) => this.toVideoEffects(value),
      },
    });
    return this.applyLoadedTimeline({
      nextClips,
      nextClipById,
      sequentialTimeUs,
    });
  }

  updateTimelineLayout(timelineClips: any[]): number {
    const meta = timelineClips.find((x) => x && typeof x === 'object' && x.kind === 'meta');
    const nextMaster = meta ? (this.toVideoEffects((meta as any).masterEffects) ?? null) : null;
    this.masterEffects = nextMaster;

    this.syncTrackRuntimes(timelineClips);

    const updated = this.timelineLayoutOrchestrator.apply({
      clips: this.clips,
      timelineClips,
      clipLayoutUpdater: this.timelineClipLayoutUpdater,
      trackRebinder: this.timelineTrackRebinder,
      updateLifecycle: this.timelineUpdateLifecycle,
      getFallbackTrackId: ({ clip, next }) =>
        this.getTrackRuntimeForClip({
          layer: Math.round(Number(next.layer ?? clip.layer ?? 0)),
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
    if (!this.app || !this.canvas) return null;

    return this.renderingEngine.renderFrame(timeUs, options, {
      app: this.app,
      canvas: this.canvas,
      width: this.width,
      height: this.height,
      clips: this.clips,
      tracks: this.tracks,
      lastRenderedTimeUs: this.lastRenderedTimeUs,
      stageSortDirty: this.stageSortDirty,
      activeSortDirty: this.activeSortDirty,
      contextLost: this.contextLost,
      setPreviewEffectsEnabled: (enabled) => {
        this.previewEffectsEnabled = enabled;
      },
      applyVideoFrameCacheLimit: (limitMb) => {
        this.videoFrameCache.applyLimitMb(limitMb);
      },
      abortInFlightResources: () => {
        this.resourceManager.abortInFlight();
      },
      updateActiveClips: (currentTimeUs, lastTimeUs) =>
        this.activeTracker.update({
          clips: this.clips,
          timeUs: currentTimeUs,
          lastTimeUs,
          onDeactivate: (clip) => {
            if (clip.sprite) {
              clip.sprite.visible = false;
            }
          },
        }),
      applyTrackState: (track) => {
        this.applyTrackEffects(track);
      },
      processFrameSamples: ({ activeClips, timeUs: currentTimeUs }) =>
        this.frameSampleOrchestrator.process({
          activeClips,
          timeUs: currentTimeUs,
          width: this.width,
          height: this.height,
          activeClipProcessor: this.timelineActiveClipProcessor,
          syncTransitionFilter: (clip, clipTimeUs) => this.syncTransitionFilter(clip, clipTimeUs),
          computeTransitionOpacity: (clip, clipTimeUs) =>
            this.computeTransitionOpacity(clip, clipTimeUs),
          applyClipEffects: (clip) => this.applyClipEffects(clip),
          drawHudClip: (clip) => this.canvasFallbackRenderer.drawHudClip(clip),
          drawShapeClip: (clip, size) => {
            this.shapeRenderer.draw({
              graphics: clip.sprite,
              type: clip.shapeType ?? 'square',
              fill: clip.fillColor ?? '#ffffff',
              stroke: clip.strokeColor ?? '#000000',
              strokeWidth: clip.strokeWidth ?? 0,
              config: clip.shapeConfig ?? {},
              canvasWidth: size.width,
              canvasHeight: size.height,
            });
          },
          drawTextClip: (clip, size) => {
            this.textRenderer.draw(clip, size.width, size.height);
            this.layoutApplier.applyTextLayout(clip);
          },
          createAbortController: (key) => this.resourceManager.createAbortController(key),
          getVideoSampleForClip: (params) => this.getVideoSampleForClip(params),
          getPrevClipOnLayer: (clip) => this.findPrevClipOnLayer(clip),
          updateClipTextureFromSample: (sample, clip) =>
            this.updateClipTextureFromSample(sample, clip),
          setClipSpriteVisible: (clip, visible) => this.setClipSpriteVisible(clip, visible),
        }),
      sortStage: () => {
        if (!this.app) {
          return;
        }

        this.stageManager.sortStage({
          app: this.app,
          tracks: this.tracks,
          getClipById: (clipId) => this.clipById.get(clipId),
          getTrackById: (trackId) => this.trackById.get(trackId),
        });
      },
      prepareAdjustmentClips: (activeClips) => {
        this.prepareAdjustmentClips(activeClips);
      },
      applyShaderTransitions: (activeClips, currentTimeUs) =>
        this.transitionRenderer.applyShaderTransitions(activeClips, currentTimeUs, {
          app: this.app!,
          clips: this.clips,
          width: this.width,
          height: this.height,
          transitionManager: this.transitionManager,
          stageTextureRenderer: this.stageTextureRenderer!,
          getTrackById: (trackId) => this.trackById.get(trackId),
          getActiveTransitionState: (clip, timeUs) => this.getActiveTransitionState(clip, timeUs),
          ensureTransitionRenderTexture: (texture) =>
            this.clipResourceManager.ensureTransitionRenderTexture(texture),
          findPrevClipOnLayer: (clip) => this.findPrevClipOnLayer(clip),
          createAbortController: (key) => this.resourceManager.createAbortController(key),
          getVideoSampleForClip: (params) => this.getVideoSampleForClip(params),
          updateClipTextureFromSample: (sample, clip) =>
            this.updateClipTextureFromSample(sample, clip),
        }),
      applyMasterEffects: () => {
        this.applyMasterEffects();
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
    });
  }

  /** Find the clip on the same layer immediately adjacent to `clip` (for blend shadow rendering).
   *  Returns null if there is a gap larger than the configured threshold. */
  private findPrevClipOnLayer(clip: CompositorClip): CompositorClip | null {
    const best = this.prevClipById.get(clip.itemId) ?? null;
    if (!best) return null;
    if (clip.startUs - best.endUs > VIDEO_CORE_LIMITS.BLEND_SHADOW_GAP_THRESHOLD_US) return null;
    return best;
  }

  private renderLowerLayersToTexture(layer: number, texture: RenderTexture) {
    this.stageTextureRenderer?.renderLowerLayersToTexture(layer, texture);
  }

  private ensureCanvasFallback(clip: CompositorClip) {
    this.canvasFallbackRenderer.ensureCanvasFallback(clip);
  }

  private computeTransitionOpacity(clip: CompositorClip, timeUs: number): number {
    return this.transitionManager.computeTransitionOpacity(
      clip,
      timeUs,
      this.previewEffectsEnabled,
    );
  }

  private getActiveTransitionState(clip: CompositorClip, timeUs: number) {
    return this.transitionManager.getActiveTransitionState(
      clip,
      timeUs,
      this.previewEffectsEnabled,
    );
  }

  private syncTransitionFilter(clip: CompositorClip, timeUs: number) {
    this.transitionManager.syncTransitionFilter(clip, timeUs, this.previewEffectsEnabled);
  }

  private applyClipEffects(clip: CompositorClip) {
    this.effectManager.applyClipEffects(clip, {
      previewEffectsEnabled: this.previewEffectsEnabled,
    });
  }

  private applyTrackEffects(track: CompositorTrack) {
    this.effectManager.applyTrackEffects(track, {
      previewEffectsEnabled: this.previewEffectsEnabled,
    });
  }

  private applyMasterEffects() {
    if (!this.app) return;
    this.effectManager.applyMasterEffects(
      this.app.stage,
      this.masterEffects,
      this.masterEffectFilters,
      { previewEffectsEnabled: this.previewEffectsEnabled },
    );
  }

  private async updateClipTextureFromSample(sample: any, clip: CompositorClip) {
    await this.clipResourceManager.updateClipTextureFromSample(sample, clip);
  }

  clearClips() {
    this.videoFrameCache.clear();
    this.transitionManager.clear();
    for (const clip of this.clips) {
      this.destroyClip(clip);
    }
    for (const track of this.tracks) {
      if (track.effectFilters) {
        for (const filter of track.effectFilters.values()) {
          try {
            (filter as any)?.destroy?.();
          } catch {
            // ignore
          }
        }
        track.effectFilters.clear();
      }
      track.container.filters = null;
      if (track.container.parent) {
        track.container.parent.removeChild(track.container);
      }
      track.container.removeChildren();
      track.container.destroy({ children: false });
    }
    this.clips = [];
    this.tracks = [];
    this.clipById.clear();
    this.prevClipById.clear();
    this.trackById.clear();
    this.trackByLayer.clear();
    this.replacedClipIds.clear();
    this.lastRenderedTimeUs = 0;
    this.activeTracker.reset();
    this.stageSortDirty = true;
    this.activeSortDirty = true;
    this.maxDurationUs = 0;
  }

  destroy() {
    this.clearClips();
    this.videoFrameCache.clear();
    this.transitionRenderer.destroy();
    if (this.stageTextureRenderer) {
      this.stageTextureRenderer.destroy();
      this.stageTextureRenderer = null;
    }
    if (this.app) {
      const pixiApp = this.app as any;

      // Pixi v8 ResizePlugin teardown may call an internal _cancelResize callback.
      // Guard it because some lifecycle interleavings leave it unset.
      if (typeof pixiApp._cancelResize !== 'function') {
        pixiApp._cancelResize = () => {};
      }
      if (typeof pixiApp.cancelResize === 'function') {
        pixiApp.cancelResize();
      }

      try {
        this.app.destroy(
          { removeView: false },
          {
            children: true,
            texture: true,
            textureSource: true,
          },
        );
      } catch (err) {
        console.error('[VideoCompositor] Application destroy failed', err);
      }
      this.app = null;
    }

    if (this.canvas && 'removeEventListener' in (this.canvas as any)) {
      try {
        (this.canvas as any).removeEventListener('webglcontextlost', this.onContextLost, false);
        (this.canvas as any).removeEventListener(
          'webglcontextrestored',
          this.onContextRestored,
          false,
        );
      } catch {
        // ignore
      }
    }
    this.canvas = null;
  }

  private destroyClip(clip: CompositorClip) {
    this.clipResourceManager.destroyClip(clip, { transitionManager: this.transitionManager });
  }
}
