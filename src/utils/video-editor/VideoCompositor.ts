import { safeDispose, parseHexColor, sanitizeTimelineColor } from './utils';
import { getMediaTypeFromFilename } from '../media-types';
import { TimelineActiveTracker } from './TimelineActiveTracker';
import { isSvgFile } from '../svg';
import {
  Application,
  Sprite,
  Texture,
  Graphics,
  CanvasSource,
  ImageSource,
  DOMAdapter,
  WebWorkerAdapter,
  RenderTexture,
  Container,
} from 'pixi.js';
import type { Filter } from 'pixi.js';
import type { WorkerTimelineClip } from '../../composables/monitor/types';
import {
  DEFAULT_TRANSITION_CURVE,
  DEFAULT_TRANSITION_MODE,
  getTransitionManifest,
  normalizeTransitionParams,
} from '~/transitions';
import type { PreviewRenderOptions } from './worker-rpc';
import {
  computeClipBoxLayout,
  TRANSFORM_DESIGN_BASE,
  resolveNormalizedAnchor,
} from './clip-layout';
import { computeTextLayoutMetrics } from './text-layout';
import { VIDEO_CORE_LIMITS } from '../constants';
import type {
  TextClipStyle,
  ClipTransform,
  ClipTransition,
  TimelineBlendMode,
  VideoClipEffect,
} from '~/timeline/types';

// Internal modules
import {
  type CompositorClip,
  type CompositorTrack,
  type HudMediaState,
  resolveBlendMode,
  areTextClipStylesEqual,
  areShapeConfigsEqual,
} from './compositor/types';
import { ResourceManager, getVideoSampleWithZeroFallback } from './compositor/ResourceManager';
import { EffectManager } from './compositor/EffectManager';
import { TransitionManager } from './compositor/TransitionManager';
import { LayoutManager } from './compositor/LayoutManager';
import { VideoRenderer } from './compositor/renderers/VideoRenderer';
import { TextRenderer } from './compositor/renderers/TextRenderer';
import { ShapeRenderer } from './compositor/renderers/ShapeRenderer';

interface CachedVideoFrameEntry {
  key: string;
  clipId: string;
  frameIndex: number;
  frame: VideoFrame;
  sizeBytes: number;
  width: number;
  height: number;
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
  private trackById = new Map<string, CompositorTrack>();
  private trackByLayer = new Map<number, CompositorTrack>();
  private tracks: CompositorTrack[] = [];
  private replacedClipIds = new Set<string>();
  private lastRenderedTimeUs = 0;
  private contextLost = false;
  private previewEffectsEnabled = true;

  private masterEffects: VideoClipEffect[] | null = null;
  private masterEffectFilters = new Map<string, Filter>();
  private transitionFilters = new Map<string, Filter>();
  private filterQuadSprite: Sprite | null = null;
  private transitionCombineSprite: Sprite | null = null;
  private stageSortDirty = true;
  private activeSortDirty = true;
  private clipPreferBitmapFallback = new Map<string, boolean>();
  private maxVideoFrameCacheBytes =
    Math.max(0, Number(VIDEO_CORE_LIMITS.MAX_VIDEO_FRAME_CACHE_MB) || 0) * 1024 * 1024;
  private videoFrameCache = new Map<string, CachedVideoFrameEntry>();
  private videoFrameCacheSizeBytes = 0;

  // Managers
  private resourceManager = new ResourceManager();
  private effectManager = new EffectManager();
  private transitionManager = new TransitionManager();
  private layoutManager = new LayoutManager();

  // Renderers
  private videoRenderer = new VideoRenderer();
  private textRenderer = new TextRenderer();
  private shapeRenderer = new ShapeRenderer();

  private readonly activeTracker = new TimelineActiveTracker<CompositorClip>({
    getId: (clip) => clip.itemId,
    getStartUs: (clip) => clip.startUs,
    getEndUs: (clip) => clip.endUs,
  });

  // Resource Management Delegation
  private async withVideoSampleSlot<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return this.resourceManager.withVideoSampleSlot(task, signal);
  }

  private resolveClipFrameRate(clip: CompositorClip): number {
    const clipFrameRate = Number(clip.frameRate);
    if (Number.isFinite(clipFrameRate) && clipFrameRate > 0) {
      return clipFrameRate;
    }
    return 30;
  }

  private computeFrameIndex(clip: CompositorClip, sampleTimeS: number): number {
    const safeTimeS = Number.isFinite(sampleTimeS) ? Math.max(0, sampleTimeS) : 0;
    const originS =
      typeof clip.firstTimestampS === 'number' && Number.isFinite(clip.firstTimestampS)
        ? Math.max(0, clip.firstTimestampS)
        : 0;
    const frameRate = this.resolveClipFrameRate(clip);
    const relativeTimeS = Math.max(0, safeTimeS - originS);
    return Math.max(0, Math.round(relativeTimeS * frameRate));
  }

  private buildVideoFrameCacheKey(clip: CompositorClip, frameIndex: number): string {
    return `${clip.itemId}:${frameIndex}`;
  }

  private applyVideoFrameCacheLimit(cacheLimitMb?: number) {
    if (typeof cacheLimitMb !== 'number' || !Number.isFinite(cacheLimitMb)) {
      return;
    }

    const normalizedBytes = Math.max(0, Math.round(cacheLimitMb)) * 1024 * 1024;
    if (normalizedBytes === this.maxVideoFrameCacheBytes) {
      return;
    }

    this.maxVideoFrameCacheBytes = normalizedBytes;
    this.evictVideoFrameCacheIfNeeded();
    if (this.maxVideoFrameCacheBytes === 0) {
      this.clearVideoFrameCache();
    }
  }

  private ensureClipRenderTexture(texture: RenderTexture | null): RenderTexture {
    const valid =
      texture &&
      !(texture as any).destroyed &&
      typeof (texture as any).uid === 'number' &&
      texture.width === this.width &&
      texture.height === this.height;

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
      width: this.width,
      height: this.height,
    });
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
      if (!adjustmentClips.includes(clip) && clip.sprite.texture !== Texture.EMPTY) {
        clip.sprite.texture = Texture.EMPTY;
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

  private estimateVideoFrameSizeBytes(frame: VideoFrame, width: number, height: number): number {
    const codedWidth = Math.max(1, Math.round(Number((frame as any).codedWidth) || width || 1));
    const codedHeight = Math.max(1, Math.round(Number((frame as any).codedHeight) || height || 1));
    return codedWidth * codedHeight * 4;
  }

  private getCachedVideoFrame(key: string): CachedVideoFrameEntry | null {
    const entry = this.videoFrameCache.get(key);
    if (!entry) return null;
    this.videoFrameCache.delete(key);
    this.videoFrameCache.set(key, entry);
    return entry;
  }

  private setCachedVideoFrame(entry: CachedVideoFrameEntry) {
    if (this.maxVideoFrameCacheBytes <= 0) {
      try {
        entry.frame.close();
      } catch {
        // ignore
      }
      return;
    }

    const existing = this.videoFrameCache.get(entry.key);
    if (existing) {
      this.videoFrameCache.delete(entry.key);
      this.videoFrameCacheSizeBytes -= existing.sizeBytes;
      try {
        existing.frame.close();
      } catch {
        // ignore
      }
    }

    this.videoFrameCache.set(entry.key, entry);
    this.videoFrameCacheSizeBytes += entry.sizeBytes;
    this.evictVideoFrameCacheIfNeeded();
  }

  private evictVideoFrameCacheIfNeeded() {
    while (
      this.videoFrameCacheSizeBytes > this.maxVideoFrameCacheBytes &&
      this.videoFrameCache.size > 0
    ) {
      const oldestKey = this.videoFrameCache.keys().next().value;
      if (typeof oldestKey !== 'string') break;
      const oldest = this.videoFrameCache.get(oldestKey);
      this.videoFrameCache.delete(oldestKey);
      if (!oldest) continue;
      this.videoFrameCacheSizeBytes -= oldest.sizeBytes;
      try {
        oldest.frame.close();
      } catch {
        // ignore
      }
    }

    if (this.videoFrameCacheSizeBytes < 0) {
      this.videoFrameCacheSizeBytes = 0;
    }
  }

  private clearVideoFrameCacheForClip(clipId: string) {
    for (const [key, entry] of this.videoFrameCache.entries()) {
      if (entry.clipId !== clipId) continue;
      this.videoFrameCache.delete(key);
      this.videoFrameCacheSizeBytes -= entry.sizeBytes;
      try {
        entry.frame.close();
      } catch {
        // ignore
      }
    }

    if (this.videoFrameCacheSizeBytes < 0) {
      this.videoFrameCacheSizeBytes = 0;
    }
  }

  private clearVideoFrameCache() {
    for (const entry of this.videoFrameCache.values()) {
      try {
        entry.frame.close();
      } catch {
        // ignore
      }
    }
    this.videoFrameCache.clear();
    this.videoFrameCacheSizeBytes = 0;
  }

  private async getVideoSampleForClip(params: {
    clip: CompositorClip;
    sampleTimeS: number;
    abortSignal?: AbortSignal;
  }): Promise<any | null> {
    const { clip, sampleTimeS, abortSignal } = params;
    const frameIndex = this.computeFrameIndex(clip, sampleTimeS);
    const cacheKey = this.buildVideoFrameCacheKey(clip, frameIndex);
    const cached = this.getCachedVideoFrame(cacheKey);
    if (cached) {
      return {
        toVideoFrame: () => cached.frame.clone(),
      };
    }

    const sample = await this.withVideoSampleSlot(
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
      const sizeBytes = this.estimateVideoFrameSizeBytes(frame, width, height);

      this.setCachedVideoFrame({
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

  private normalizeTrackOpacity(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    return Math.max(0, Math.min(1, value));
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

  private buildTrackRuntimeList(timelineItems: any[]): Array<{
    id: string;
    layer: number;
    opacity?: number;
    blendMode?: TimelineBlendMode;
    effects?: VideoClipEffect[];
  }> {
    const explicitTracks = timelineItems
      .filter((item) => item && typeof item === 'object' && item.kind === 'track')
      .map((track) => ({
        id:
          typeof track.id === 'string' && track.id.length > 0
            ? track.id
            : `track_${String(track.layer ?? 0)}`,
        layer: Math.round(Number(track.layer ?? 0)),
        opacity: this.normalizeTrackOpacity(track.opacity),
        blendMode: resolveBlendMode(track.blendMode),
        effects: this.toVideoEffects(track.effects),
      }));

    const inferredLayers = new Set<number>();
    for (const item of timelineItems) {
      if (!item || typeof item !== 'object' || item.kind !== 'clip') continue;
      inferredLayers.add(Math.round(Number(item.layer ?? 0)));
    }

    const explicitLayers = new Set(explicitTracks.map((track) => track.layer));
    const inferredTracks = [...inferredLayers]
      .filter((layer) => !explicitLayers.has(layer))
      .sort((a, b) => a - b)
      .map((layer) => ({
        id: `track_${layer}`,
        layer,
        opacity: 1,
        blendMode: 'normal' as const,
      }));

    return [...explicitTracks, ...inferredTracks].sort((a, b) => a.layer - b.layer);
  }

  private syncTrackRuntimes(timelineItems: any[]) {
    if (!this.app) return;

    const nextDefs = this.buildTrackRuntimeList(timelineItems);
    const nextTrackById = new Map<string, CompositorTrack>();
    const nextTrackByLayer = new Map<number, CompositorTrack>();
    const nextTracks: CompositorTrack[] = [];

    for (const def of nextDefs) {
      const existing = this.trackById.get(def.id) ?? this.trackByLayer.get(def.layer);
      const track = existing ?? {
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
    this.prevClipById.clear();

    const byLayer = new Map<number, CompositorClip[]>();
    for (const clip of this.clips) {
      const clips = byLayer.get(clip.layer);
      if (clips) {
        clips.push(clip);
      } else {
        byLayer.set(clip.layer, [clip]);
      }
    }

    for (const layerClips of byLayer.values()) {
      const sorted = [...layerClips].sort(
        (a, b) => a.startUs - b.startUs || a.endUs - b.endUs || a.itemId.localeCompare(b.itemId),
      );

      for (let index = 0; index < sorted.length; index++) {
        const clip = sorted[index];
        if (!clip) continue;
        // Previous clip is always at index-1 in sorted order (O(n) instead of O(n²))
        const prev = index > 0 ? (sorted[index - 1] ?? null) : null;
        this.prevClipById.set(clip.itemId, prev);
      }
    }
  }

  private sortTrackContainerChildren() {
    for (const track of this.tracks) {
      track.container.children.sort((a: any, b: any) => {
        const aClip = this.clipById.get((a as any)?.__clipId ?? '') as CompositorClip | undefined;
        const bClip = this.clipById.get((b as any)?.__clipId ?? '') as CompositorClip | undefined;

        const aStartUs = aClip?.startUs ?? 0;
        const bStartUs = bClip?.startUs ?? 0;
        if (aStartUs !== bStartUs) {
          return aStartUs - bStartUs;
        }

        const aEndUs = aClip?.endUs ?? 0;
        const bEndUs = bClip?.endUs ?? 0;
        if (aEndUs !== bEndUs) {
          return aEndUs - bEndUs;
        }

        const aOrder = typeof (a as any)?.__clipOrder === 'number' ? (a as any).__clipOrder : 0;
        const bOrder = typeof (b as any)?.__clipOrder === 'number' ? (b as any).__clipOrder : 0;
        if (aOrder !== bOrder) {
          return aOrder - bOrder;
        }

        return String((a as any)?.__clipId ?? '').localeCompare(String((b as any)?.__clipId ?? ''));
      });
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
    this.clearVideoFrameCache();
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

    const nextClips: CompositorClip[] = [];
    const nextClipById = new Map<string, CompositorClip>();
    let sequentialTimeUs = 0; // For fallback if startUs is missing

    for (const [index, clipData] of timelineClips.entries()) {
      if (checkCancel?.()) {
        // Очищаем частично загруженные ресурсы
        for (const clip of nextClips) {
          if (!this.clipById.has(clip.itemId)) {
            this.destroyClip(clip);
          }
        }
        const abortErr = new Error('Export was cancelled during timeline load');
        (abortErr as any).name = 'AbortError';
        throw abortErr;
      }
      if (clipData.kind !== 'clip') continue;

      const clipTypeRaw = (clipData as any).clipType;
      const clipType =
        clipTypeRaw === 'background' ||
        clipTypeRaw === 'adjustment' ||
        clipTypeRaw === 'media' ||
        clipTypeRaw === 'text' ||
        clipTypeRaw === 'shape' ||
        clipTypeRaw === 'hud'
          ? clipTypeRaw
          : 'media';

      const itemId =
        typeof clipData.id === 'string' && clipData.id.length > 0 ? clipData.id : `clip_${index}`;
      const sourcePath =
        typeof clipData?.source?.path === 'string' && clipData.source.path.length > 0
          ? clipData.source.path
          : '';

      const sourceStartUs = Math.max(0, Math.round(Number(clipData.sourceRange?.startUs ?? 0)));
      const freezeFrameSourceUsRaw = clipData.freezeFrameSourceUs;
      const freezeFrameSourceUs =
        typeof freezeFrameSourceUsRaw === 'number' && Number.isFinite(freezeFrameSourceUsRaw)
          ? Math.max(0, Math.round(freezeFrameSourceUsRaw))
          : undefined;
      const layer = Math.round(Number(clipData.layer ?? 0));
      const trackId =
        typeof clipData.trackId === 'string' && clipData.trackId.length > 0
          ? clipData.trackId
          : this.getTrackRuntimeForClip({ layer })?.id;
      const requestedTimelineDurationUs = Math.max(
        0,
        Math.round(Number(clipData.timelineRange?.durationUs ?? 0)),
      );
      const requestedSourceRangeDurationUs = Math.max(
        0,
        Math.round(Number(clipData.sourceRange?.durationUs ?? requestedTimelineDurationUs)),
      );
      const clipSourceDurationRaw = (clipData as any).sourceDurationUs;
      const requestedSourceDurationUs = Math.max(
        0,
        Math.round(
          Number(
            typeof clipSourceDurationRaw === 'number' && clipSourceDurationRaw > 0
              ? clipSourceDurationRaw
              : clipData.sourceRange?.durationUs || requestedTimelineDurationUs,
          ),
        ),
      );

      const speedRaw = (clipData as any).speed;
      const speed =
        typeof speedRaw === 'number' && Number.isFinite(speedRaw) && speedRaw !== 0
          ? Math.max(-10, Math.min(10, speedRaw))
          : undefined;

      const startUs =
        typeof clipData.timelineRange?.startUs === 'number'
          ? Math.max(0, Math.round(Number(clipData.timelineRange.startUs)))
          : sequentialTimeUs;

      const endUsFallback = startUs + Math.max(0, requestedTimelineDurationUs);

      const reusable = this.clipById.get(itemId);
      if (
        reusable &&
        reusable.sourcePath === sourcePath &&
        (reusable as any).clipType === clipType
      ) {
        const safeSourceDurationUs =
          requestedSourceDurationUs > 0 ? requestedSourceDurationUs : reusable.sourceDurationUs;
        const safeTimelineDurationUs =
          requestedTimelineDurationUs > 0 ? requestedTimelineDurationUs : safeSourceDurationUs;

        if (reusable.clipKind === 'video') {
          const hasFirstTimestamp =
            typeof reusable.firstTimestampS === 'number' &&
            Number.isFinite(reusable.firstTimestampS);
          if (!hasFirstTimestamp && reusable.input) {
            try {
              const track = await reusable.input.getPrimaryVideoTrack();
              if (track) {
                reusable.firstTimestampS = await track.getFirstTimestamp();
              }
            } catch {
              // ignore
            }
          }
        }

        reusable.startUs = startUs;
        reusable.durationUs = safeTimelineDurationUs;
        reusable.endUs = startUs + safeTimelineDurationUs;
        reusable.sourceStartUs = sourceStartUs;
        reusable.sourceRangeDurationUs =
          requestedSourceRangeDurationUs > 0
            ? requestedSourceRangeDurationUs
            : reusable.sourceRangeDurationUs;
        reusable.sourceDurationUs = safeSourceDurationUs;
        reusable.speed = speed;

        reusable.freezeFrameSourceUs = freezeFrameSourceUs;
        reusable.layer = layer;
        reusable.trackId = trackId;
        reusable.opacity = clipData.opacity;
        reusable.blendMode = resolveBlendMode((clipData as any).blendMode);
        reusable.effects = this.toVideoEffects(clipData.effects);
        reusable.transform = (clipData as any).transform;
        reusable.transitionIn = clipData.transitionIn;
        reusable.transitionOut = clipData.transitionOut;
        if (reusable.clipKind === 'text') {
          const nextText = String((clipData as any).text ?? '');
          const nextStyle = (clipData as any).style;
          reusable.textDirty =
            reusable.text !== nextText || !areTextClipStylesEqual(reusable.style, nextStyle);
          reusable.text = nextText;
          reusable.style = nextStyle;
        }
        const reusableTrack = this.getTrackRuntimeForClip(reusable);
        if (reusableTrack && reusable.sprite.parent !== reusableTrack.container) {
          reusableTrack.container.addChild(reusable.sprite);
        }
        if (reusable.clipKind === 'solid') {
          reusable.backgroundColor = String((clipData as any).backgroundColor ?? '#000000');
          reusable.sprite.tint = parseHexColor(reusable.backgroundColor);
          this.applySolidLayout(reusable);
        }
        if (reusable.clipKind === 'shape') {
          reusable.shapeType = (clipData as any).shapeType ?? reusable.shapeType ?? 'square';
          reusable.fillColor = String(
            (clipData as any).fillColor ?? reusable.fillColor ?? '#ffffff',
          );
          reusable.strokeColor = String(
            (clipData as any).strokeColor ?? reusable.strokeColor ?? '#000000',
          );
          reusable.strokeWidth = Number((clipData as any).strokeWidth ?? reusable.strokeWidth ?? 0);
          const nextConfig = (clipData as any).shapeConfig;
          if (!areShapeConfigsEqual(reusable.shapeConfig as any, nextConfig)) {
            reusable.shapeConfig = nextConfig ? JSON.parse(JSON.stringify(nextConfig)) : undefined;
          }
          reusable.shapeDirty = true;
        }

        reusable.sprite.visible = false;

        nextClips.push(reusable);
        nextClipById.set(itemId, reusable);
        sequentialTimeUs = Math.max(sequentialTimeUs, reusable.endUs, endUsFallback);
        continue;
      }

      if (clipType === 'background') {
        const endUs = startUs + Math.max(0, requestedTimelineDurationUs);
        sequentialTimeUs = Math.max(sequentialTimeUs, endUs);

        if (reusable) {
          this.destroyClip(reusable);
          this.replacedClipIds.add(itemId);
        }

        const sprite = new Sprite(Texture.WHITE);
        sprite.width = 1;
        sprite.height = 1;
        sprite.visible = false;
        (sprite as any).__clipId = itemId;

        const backgroundColor = sanitizeTimelineColor((clipData as any).backgroundColor, '#000000');
        sprite.tint = parseHexColor(backgroundColor);

        const compositorClip: CompositorClip = {
          itemId,
          trackId,
          layer,
          startUs,
          endUs,
          durationUs: Math.max(0, requestedTimelineDurationUs),
          sourceStartUs: 0,
          sourceRangeDurationUs: Math.max(0, requestedTimelineDurationUs),
          sourceDurationUs: Math.max(0, requestedTimelineDurationUs),
          speed,
          sprite,
          clipKind: 'solid',
          sourceKind: 'bitmap',
          imageSource: new ImageSource({ resource: new OffscreenCanvas(2, 2) as any }),
          lastVideoFrame: null,
          canvas: null,
          ctx: null,
          bitmap: null,
          backgroundColor,
          opacity: clipData.opacity,
          blendMode: resolveBlendMode((clipData as any).blendMode),
          effects: this.toVideoEffects(clipData.effects),
          transform: (clipData as any).transform,
        };

        compositorClip.clipType = 'background';

        const trackRuntime = this.getTrackRuntimeForClip(compositorClip);
        if (trackRuntime) {
          trackRuntime.container.addChild(sprite);
        } else {
          this.app.stage.addChild(sprite);
        }

        this.applySolidLayout(compositorClip);

        nextClips.push(compositorClip);
        nextClipById.set(itemId, compositorClip);
        continue;
      }

      if (clipType === 'text') {
        const endUs = startUs + Math.max(0, requestedTimelineDurationUs);
        sequentialTimeUs = Math.max(sequentialTimeUs, endUs);

        if (reusable) {
          this.destroyClip(reusable);
          this.replacedClipIds.add(itemId);
        }

        // Text clips render via Canvas2D into a Sprite
        const sprite = new Sprite(Texture.EMPTY);
        sprite.visible = false;
        (sprite as any).__clipId = itemId;

        const compositorClip: CompositorClip = {
          itemId,
          trackId,
          layer,
          startUs,
          endUs,
          durationUs: Math.max(0, requestedTimelineDurationUs),
          sourceStartUs: 0,
          sourceRangeDurationUs: Math.max(0, requestedTimelineDurationUs),
          sourceDurationUs: Math.max(0, requestedTimelineDurationUs),
          speed,
          sprite,
          clipKind: 'text',
          sourceKind: 'canvas',
          imageSource: new ImageSource({ resource: new OffscreenCanvas(2, 2) as any }), // Will be replaced by CanvasSource
          lastVideoFrame: null,
          canvas: null,
          ctx: null,
          bitmap: null,
          text: String((clipData as any).text ?? ''),
          style: (clipData as any).style,
          opacity: clipData.opacity,
          blendMode: resolveBlendMode((clipData as any).blendMode),
          effects: this.toVideoEffects(clipData.effects),
          transform: (clipData as any).transform,
          transitionIn: clipData.transitionIn,
          transitionOut: clipData.transitionOut,
          transitionFilter: null,
          transitionFilterType: null,
          textDirty: true,
        };

        compositorClip.clipType = 'text';

        const trackRuntime = this.getTrackRuntimeForClip(compositorClip);
        if (trackRuntime) {
          trackRuntime.container.addChild(sprite);
        } else {
          this.app.stage.addChild(sprite);
        }

        nextClips.push(compositorClip);
        nextClipById.set(itemId, compositorClip);
        continue;
      }

      if (clipType === 'shape') {
        const endUs = startUs + Math.max(0, requestedTimelineDurationUs);
        sequentialTimeUs = Math.max(sequentialTimeUs, endUs);

        if (reusable) {
          this.destroyClip(reusable);
          this.replacedClipIds.add(itemId);
        }

        const sprite = new Graphics();
        sprite.visible = false;
        (sprite as any).__clipId = itemId;

        const compositorClip: CompositorClip = {
          itemId,
          trackId,
          layer,
          startUs,
          endUs,
          durationUs: Math.max(0, requestedTimelineDurationUs),
          sourceStartUs: 0,
          sourceRangeDurationUs: Math.max(0, requestedTimelineDurationUs),
          sourceDurationUs: Math.max(0, requestedTimelineDurationUs),
          speed,
          sprite,
          clipKind: 'shape',
          sourceKind: 'graphics',
          imageSource: new ImageSource({ resource: new OffscreenCanvas(2, 2) as any }),
          lastVideoFrame: null,
          canvas: null,
          ctx: null,
          bitmap: null,
          shapeType: (clipData as any).shapeType ?? 'square',
          fillColor: String((clipData as any).fillColor ?? '#ffffff'),
          strokeColor: String((clipData as any).strokeColor ?? '#000000'),
          strokeWidth: Number((clipData as any).strokeWidth ?? 0),
          opacity: clipData.opacity,
          blendMode: resolveBlendMode((clipData as any).blendMode),
          effects: this.toVideoEffects(clipData.effects),
          transform: (clipData as any).transform,
          transitionIn: clipData.transitionIn,
          transitionOut: clipData.transitionOut,
          transitionFilter: null,
          transitionFilterType: null,
          shapeDirty: true,
        };

        compositorClip.clipType = 'shape';

        const trackRuntime = this.getTrackRuntimeForClip(compositorClip);
        if (trackRuntime) {
          trackRuntime.container.addChild(sprite as any);
        } else {
          this.app.stage.addChild(sprite as any);
        }

        this.applyShapeLayout(compositorClip);

        nextClips.push(compositorClip);
        nextClipById.set(itemId, compositorClip);
        continue;
      }

      if (clipType === 'adjustment') {
        const endUs = startUs + Math.max(0, requestedTimelineDurationUs);
        sequentialTimeUs = Math.max(sequentialTimeUs, endUs);

        if (reusable) {
          this.destroyClip(reusable);
          this.replacedClipIds.add(itemId);
        }

        const sprite = new Sprite(Texture.EMPTY);
        sprite.width = this.width;
        sprite.height = this.height;
        sprite.visible = false;
        (sprite as any).__clipId = itemId;

        const compositorClip: CompositorClip = {
          itemId,
          trackId,
          layer,
          startUs,
          endUs,
          durationUs: Math.max(0, requestedTimelineDurationUs),
          sourceStartUs: 0,
          sourceRangeDurationUs: Math.max(0, requestedTimelineDurationUs),
          sourceDurationUs: Math.max(0, requestedTimelineDurationUs),
          speed,
          sprite,
          clipKind: 'adjustment',
          sourceKind: 'bitmap',
          imageSource: new ImageSource({ resource: new OffscreenCanvas(2, 2) as any }),
          lastVideoFrame: null,
          canvas: null,
          ctx: null,
          bitmap: null,
          opacity: clipData.opacity,
          blendMode: resolveBlendMode((clipData as any).blendMode),
          effects: this.toVideoEffects(clipData.effects),
          transform: (clipData as any).transform,
          adjustmentSourceTexture: null,
        };

        compositorClip.clipType = 'adjustment';

        const trackRuntime = this.getTrackRuntimeForClip(compositorClip);
        if (trackRuntime) {
          trackRuntime.container.addChild(sprite);
        } else {
          this.app.stage.addChild(sprite);
        }

        nextClips.push(compositorClip);
        nextClipById.set(itemId, compositorClip);
        continue;
      }

      if (clipType === 'hud') {
        const endUs = startUs + Math.max(0, requestedTimelineDurationUs);
        sequentialTimeUs = Math.max(sequentialTimeUs, endUs);

        if (reusable) {
          this.destroyClip(reusable);
          this.replacedClipIds.add(itemId);
        }

        const sprite = new Sprite(Texture.EMPTY);
        sprite.width = this.width;
        sprite.height = this.height;
        sprite.visible = false;
        (sprite as any).__clipId = itemId;

        const compositorClip: CompositorClip = {
          itemId,
          trackId,
          layer,
          startUs,
          endUs,
          durationUs: Math.max(0, requestedTimelineDurationUs),
          sourceStartUs: 0,
          sourceRangeDurationUs: Math.max(0, requestedTimelineDurationUs),
          sourceDurationUs: Math.max(0, requestedTimelineDurationUs),
          speed,
          sprite,
          clipKind: 'hud',
          sourceKind: 'bitmap',
          imageSource: new ImageSource({ resource: new OffscreenCanvas(2, 2) as any }),
          lastVideoFrame: null,
          canvas: new OffscreenCanvas(this.width, this.height),
          ctx: null,
          bitmap: null,
          hudType: (clipData as any).hudType ?? 'media_frame',
          background: (clipData as any).background,
          content: (clipData as any).content,
          opacity: clipData.opacity,
          blendMode: resolveBlendMode((clipData as any).blendMode),
          effects: this.toVideoEffects(clipData.effects),
          transform: (clipData as any).transform,
          transitionIn: clipData.transitionIn,
          transitionOut: clipData.transitionOut,
          transitionFilter: null,
          transitionFilterType: null,
          hudMediaStates: {},
        };

        const ctx = compositorClip.canvas?.getContext('2d');
        if (ctx) {
          compositorClip.ctx = ctx as OffscreenCanvasRenderingContext2D;
          const canvasSource = new CanvasSource({ resource: compositorClip.canvas as any });
          sprite.texture.source = canvasSource as any;
        }

        compositorClip.clipType = 'hud';

        const trackRuntime = this.getTrackRuntimeForClip(compositorClip);
        if (trackRuntime) {
          trackRuntime.container.addChild(sprite);
        } else {
          this.app.stage.addChild(sprite);
        }

        // Initialize HUD media states
        const bgPath = compositorClip.background?.source?.path;
        if (bgPath) {
          try {
            const handle = await deps.getFileHandleByPath(bgPath);
            if (handle) {
              const file = (await deps.getFileByPath?.(bgPath)) ?? (await handle.getFile());
              const isImage =
                (typeof file?.type === 'string' && file.type.startsWith('image/')) ||
                getMediaTypeFromFilename(bgPath) === 'image';

              if (isImage) {
                let bmp: ImageBitmap | null = null;
                let imageFile = file;
                if (
                  isSvgFile({ file, path: bgPath }) &&
                  deps.getCurrentProjectId &&
                  deps.ensureVectorImageRaster
                ) {
                  const projectId = await deps.getCurrentProjectId();
                  if (projectId) {
                    const cached = await deps.ensureVectorImageRaster({
                      projectId,
                      projectRelativePath: bgPath,
                      width: this.width,
                      height: this.height,
                      sourceFileHandle: handle,
                    });
                    if (cached) imageFile = await cached.getFile();
                  }
                }
                bmp = await createImageBitmap(imageFile);
                if (compositorClip.hudMediaStates) {
                  compositorClip.hudMediaStates.background = {
                    sourcePath: bgPath,
                    fileHandle: handle,
                    sourceDurationUs: 0,
                    clipKind: 'image',
                    sourceKind: 'bitmap',
                    imageSource: new ImageSource({ resource: new OffscreenCanvas(2, 2) as any }),
                    sprite: new Sprite(Texture.EMPTY),
                    lastVideoFrame: null,
                    bitmap: bmp,
                  };
                }
              } else {
                // Video support for HUD backgrounds can be added here
              }
            }
          } catch (e) {
            console.error('[VideoCompositor] Failed to load HUD background', e);
          }
        }

        const contentPath = compositorClip.content?.source?.path;
        if (contentPath) {
          try {
            const handle = await deps.getFileHandleByPath(contentPath);
            if (handle) {
              const file = (await deps.getFileByPath?.(contentPath)) ?? (await handle.getFile());
              const isImage =
                (typeof file?.type === 'string' && file.type.startsWith('image/')) ||
                getMediaTypeFromFilename(contentPath) === 'image';

              if (isImage) {
                let bmp: ImageBitmap | null = null;
                let imageFile = file;
                if (
                  isSvgFile({ file, path: contentPath }) &&
                  deps.getCurrentProjectId &&
                  deps.ensureVectorImageRaster
                ) {
                  const projectId = await deps.getCurrentProjectId();
                  if (projectId) {
                    const cached = await deps.ensureVectorImageRaster({
                      projectId,
                      projectRelativePath: contentPath,
                      width: this.width,
                      height: this.height,
                      sourceFileHandle: handle,
                    });
                    if (cached) imageFile = await cached.getFile();
                  }
                }
                bmp = await createImageBitmap(imageFile);
                if (compositorClip.hudMediaStates) {
                  compositorClip.hudMediaStates.content = {
                    sourcePath: contentPath,
                    fileHandle: handle,
                    sourceDurationUs: 0,
                    clipKind: 'image',
                    sourceKind: 'bitmap',
                    imageSource: new ImageSource({ resource: new OffscreenCanvas(2, 2) as any }),
                    sprite: new Sprite(Texture.EMPTY),
                    lastVideoFrame: null,
                    bitmap: bmp,
                  };
                }
              } else {
                // Video support for HUD content can be added here
              }
            }
          } catch (e) {
            console.error('[VideoCompositor] Failed to load HUD content', e);
          }
        }

        nextClips.push(compositorClip);
        nextClipById.set(itemId, compositorClip);
        continue;
      }

      if (!sourcePath) {
        sequentialTimeUs = Math.max(sequentialTimeUs, endUsFallback);
        continue;
      }

      if (reusable) {
        this.destroyClip(reusable);
        this.replacedClipIds.add(itemId);
      }

      const fileHandle = await deps.getFileHandleByPath(sourcePath);
      if (!fileHandle) {
        sequentialTimeUs = Math.max(sequentialTimeUs, endUsFallback);
        continue;
      }

      const file = (await deps.getFileByPath?.(sourcePath)) ?? (await fileHandle.getFile());

      const isImage =
        (typeof file?.type === 'string' && file.type.startsWith('image/')) ||
        getMediaTypeFromFilename(sourcePath) === 'image';
      if (isImage) {
        const endUs = startUs + Math.max(0, requestedTimelineDurationUs);
        sequentialTimeUs = Math.max(sequentialTimeUs, endUs);

        const imageSource = new ImageSource({ resource: new OffscreenCanvas(2, 2) as any });
        const texture = new Texture({ source: imageSource });
        const sprite = new Sprite(texture);
        sprite.width = 1;
        sprite.height = 1;
        sprite.visible = false;
        (sprite as any).__clipId = itemId;

        let bmp: ImageBitmap | null = null;
        try {
          let imageFile = file;
          if (
            isSvgFile({ file, path: sourcePath }) &&
            deps.getCurrentProjectId &&
            deps.ensureVectorImageRaster
          ) {
            const projectId = await deps.getCurrentProjectId();
            if (projectId) {
              const cachedRasterHandle = await deps.ensureVectorImageRaster({
                projectId,
                projectRelativePath: sourcePath,
                width: this.width,
                height: this.height,
                sourceFileHandle: fileHandle,
              });
              if (cachedRasterHandle) {
                imageFile = await cachedRasterHandle.getFile();
              }
            }
          }

          bmp = await createImageBitmap(imageFile);
          const frameW = Math.max(1, Math.round((bmp as any).width ?? 1));
          const frameH = Math.max(1, Math.round((bmp as any).height ?? 1));
          imageSource.resize(frameW, frameH);
          (imageSource as any).resource = bmp as any;
          imageSource.update();
          this.applySpriteLayout(frameW, frameH, {
            sprite,
          } as any);
        } catch (e) {
          if (bmp) {
            try {
              bmp.close();
            } catch {
              // ignore
            }
          }
          sprite.visible = false;
        }

        const compositorClip: CompositorClip = {
          itemId,
          trackId,
          layer,
          sourcePath,
          fileHandle,
          startUs,
          endUs,
          durationUs: Math.max(0, requestedTimelineDurationUs),
          sourceStartUs: 0,
          sourceRangeDurationUs: Math.max(0, requestedTimelineDurationUs),
          sourceDurationUs: Math.max(0, requestedTimelineDurationUs),
          speed,
          sprite,
          clipKind: 'image',
          sourceKind: 'bitmap',
          imageSource,
          lastVideoFrame: null,
          canvas: null,
          ctx: null,
          bitmap: bmp,
          backgroundColor: undefined,
          opacity: clipData.opacity,
          blendMode: resolveBlendMode((clipData as any).blendMode),
          effects: this.toVideoEffects(clipData.effects),
          transform: (clipData as any).transform,
          transitionIn: clipData.transitionIn,
          transitionOut: clipData.transitionOut,
        };

        const trackRuntime = this.getTrackRuntimeForClip(compositorClip);
        if (trackRuntime) {
          trackRuntime.container.addChild(sprite);
        } else {
          this.app.stage.addChild(sprite);
        }

        nextClips.push(compositorClip);
        nextClipById.set(itemId, compositorClip);
        continue;
      }

      try {
        const source = new BlobSource(file);
        const input = new Input({ source, formats: ALL_FORMATS } as any);
        const track = await input.getPrimaryVideoTrack();

        if (!track || !(await track.canDecode())) {
          safeDispose(input);
          continue;
        }

        const sink = new VideoSampleSink(track);
        const firstTimestampS = await track.getFirstTimestamp();
        const trackAny = track as any;
        const frameRateRaw =
          typeof trackAny.getFrameRate === 'function'
            ? await trackAny.getFrameRate()
            : (trackAny.frameRate ?? trackAny.fps);
        const frameRate = Number(frameRateRaw);
        const mediaDurationUs = Math.max(
          0,
          Math.round((await track.computeDuration()) * 1_000_000),
        );
        const maxSourceTailUs = Math.max(0, mediaDurationUs - sourceStartUs);
        const sourceDurationUs =
          requestedSourceDurationUs > 0
            ? Math.min(requestedSourceDurationUs, maxSourceTailUs)
            : maxSourceTailUs;
        const durationUs =
          requestedTimelineDurationUs > 0 ? requestedTimelineDurationUs : sourceDurationUs;
        const endUs = startUs + durationUs;

        sequentialTimeUs = Math.max(sequentialTimeUs, endUs);

        // Start with a VideoFrame-powered texture source when available.
        // Fallback to a per-clip OffscreenCanvas if VideoFrame upload fails at runtime.
        const imageSource = new ImageSource({ resource: new OffscreenCanvas(2, 2) as any });
        const texture = new Texture({ source: imageSource });
        const sprite = new Sprite(texture);

        sprite.width = 1;
        sprite.height = 1;
        sprite.visible = false;
        (sprite as any).__clipId = itemId;

        const compositorClip: CompositorClip = {
          itemId,
          trackId,
          layer,
          sourcePath,
          fileHandle,
          input,
          sink,
          firstTimestampS,
          frameRate: Number.isFinite(frameRate) && frameRate > 0 ? frameRate : undefined,
          startUs,
          endUs,
          durationUs,
          sourceStartUs,
          sourceRangeDurationUs:
            requestedSourceRangeDurationUs > 0 ? requestedSourceRangeDurationUs : durationUs,
          sourceDurationUs,
          speed,
          freezeFrameSourceUs,
          sprite,
          clipKind: 'video',
          sourceKind: 'videoFrame',
          imageSource,
          lastVideoFrame: null,
          canvas: null,
          ctx: null,
          bitmap: null,
          backgroundColor: undefined,
          opacity: clipData.opacity,
          blendMode: resolveBlendMode((clipData as any).blendMode),
          effects: this.toVideoEffects(clipData.effects),
          transform: (clipData as any).transform,
          transitionIn: clipData.transitionIn,
          transitionOut: clipData.transitionOut,
        };

        const trackRuntime = this.getTrackRuntimeForClip(compositorClip);
        if (trackRuntime) {
          trackRuntime.container.addChild(sprite);
        } else {
          this.app.stage.addChild(sprite);
        }

        nextClips.push(compositorClip);
        nextClipById.set(itemId, compositorClip);
      } catch (err: any) {
        if (err?.message !== 'Input has an unsupported or unrecognizable format.') {
          console.error(`[VideoCompositor] Failed to load video clip ${itemId}:`, err);
        }
        sequentialTimeUs = Math.max(sequentialTimeUs, endUsFallback);
        continue;
      }
    }

    for (const [prevId, prevClip] of this.clipById.entries()) {
      if (this.replacedClipIds.has(prevId)) {
        continue;
      }
      if (!nextClipById.has(prevId)) {
        this.destroyClip(prevClip);
      }
    }
    this.replacedClipIds.clear();

    this.clips = nextClips;
    this.clipById = nextClipById;
    this.clips.sort((a, b) => a.startUs - b.startUs || a.layer - b.layer);
    this.rebuildPrevClipIndex();
    const maxClipEndUs = this.clips.length > 0 ? Math.max(0, ...this.clips.map((c) => c.endUs)) : 0;
    this.maxDurationUs = Math.max(maxClipEndUs, sequentialTimeUs);

    this.lastRenderedTimeUs = 0;
    this.activeTracker.reset();
    this.stageSortDirty = true;
    this.activeSortDirty = true;

    return this.maxDurationUs;
  }

  updateTimelineLayout(timelineClips: any[]): number {
    const meta = timelineClips.find((x) => x && typeof x === 'object' && x.kind === 'meta');
    const nextMaster = meta ? (this.toVideoEffects((meta as any).masterEffects) ?? null) : null;
    this.masterEffects = nextMaster;
    this.syncTrackRuntimes(timelineClips);

    const byId = new Map<string, any>();
    for (const clipData of timelineClips) {
      if (clipData?.kind !== 'clip') continue;
      if (typeof clipData.id !== 'string' || clipData.id.length === 0) continue;
      byId.set(clipData.id, clipData);
    }

    for (const clip of this.clips) {
      const next = byId.get(clip.itemId);
      if (!next) continue;

      const startUs = Math.max(0, Math.round(Number(next.timelineRange?.startUs ?? clip.startUs)));
      const timelineDurationUs = Math.max(
        0,
        Math.round(Number(next.timelineRange?.durationUs ?? clip.durationUs)),
      );
      const sourceStartUs = Math.max(
        0,
        Math.round(Number(next.sourceRange?.startUs ?? clip.sourceStartUs)),
      );
      const sourceRangeDurationUs = Math.max(
        0,
        Math.round(Number(next.sourceRange?.durationUs ?? clip.sourceRangeDurationUs)),
      );
      const nextSourceDurationRaw = (next as any).sourceDurationUs;
      const sourceDurationUs = Math.max(
        0,
        Math.round(
          Number(
            typeof nextSourceDurationRaw === 'number' && nextSourceDurationRaw > 0
              ? nextSourceDurationRaw
              : clip.sourceDurationUs,
          ),
        ),
      );
      const layer = Math.round(Number(next.layer ?? clip.layer ?? 0));
      const speedRaw = (next as any).speed;
      const speed =
        typeof speedRaw === 'number' && Number.isFinite(speedRaw) && speedRaw !== 0
          ? Math.max(-10, Math.min(10, speedRaw))
          : undefined;

      const freezeFrameSourceUsRaw = (next as any).freezeFrameSourceUs;
      const freezeFrameSourceUs =
        typeof freezeFrameSourceUsRaw === 'number' && Number.isFinite(freezeFrameSourceUsRaw)
          ? Math.max(0, Math.round(freezeFrameSourceUsRaw))
          : undefined;

      clip.startUs = startUs;
      clip.durationUs = timelineDurationUs;
      clip.endUs = startUs + timelineDurationUs;
      clip.sourceStartUs = sourceStartUs;
      clip.sourceRangeDurationUs = sourceRangeDurationUs;
      clip.sourceDurationUs = sourceDurationUs;
      clip.speed = speed;

      clip.freezeFrameSourceUs = freezeFrameSourceUs;
      clip.layer = layer;
      clip.trackId =
        typeof next.trackId === 'string' && next.trackId.length > 0
          ? next.trackId
          : this.getTrackRuntimeForClip({ layer })?.id;
      clip.opacity = next.opacity;
      clip.blendMode = resolveBlendMode((next as any).blendMode);
      clip.effects = this.toVideoEffects(next.effects);
      clip.transform = (next as any).transform;
      this.applyClipLayoutForCurrentSource(clip);
      const prevTransitionInType = clip.transitionIn?.type ?? null;
      const nextTransitionInType = (next as any).transitionIn?.type ?? null;
      clip.transitionIn = (next as any).transitionIn;
      clip.transitionOut = (next as any).transitionOut;
      if (prevTransitionInType !== nextTransitionInType) {
        if (clip.transitionFilter) {
          try {
            clip.transitionFilter.destroy();
          } catch {
            // ignore
          }
        }
        this.transitionFilters.delete(clip.itemId);
        clip.transitionFilter = null;
        clip.transitionFilterType = null;
        if (clip.transitionSprite) {
          clip.transitionSprite.visible = false;
          clip.transitionSprite.filters = null;
        }
      }
      if (clip.clipKind === 'text') {
        const nextText = String((next as any).text ?? '');
        const nextStyle = (next as any).style;
        const styleChanged = !areTextClipStylesEqual(clip.style, nextStyle);
        clip.textDirty = clip.text !== nextText || styleChanged || clip.textDirty === true;
        clip.text = nextText;
        clip.style = nextStyle;
      }
      if (clip.clipKind === 'shape') {
        const nextType = (next as any).shapeType ?? 'square';
        const nextFill = String((next as any).fillColor ?? '#ffffff');
        const nextStroke = String((next as any).strokeColor ?? '#000000');
        const nextStrokeWidth = Number((next as any).strokeWidth ?? 0);
        const nextConfig = (next as any).shapeConfig;

        if (
          clip.shapeType !== nextType ||
          clip.fillColor !== nextFill ||
          clip.strokeColor !== nextStroke ||
          clip.strokeWidth !== nextStrokeWidth ||
          !areShapeConfigsEqual(clip.shapeConfig as any, nextConfig as any) ||
          clip.shapeDirty === true
        ) {
          clip.shapeDirty = true;
        }

        clip.shapeType = nextType;
        clip.fillColor = nextFill;
        clip.strokeColor = nextStroke;
        clip.strokeWidth = nextStrokeWidth;
        clip.shapeConfig = nextConfig ? JSON.parse(JSON.stringify(nextConfig)) : undefined;
      }
      if (clip.clipKind === 'hud') {
        const nextBg = (next as any).background?.source?.path;
        const nextContent = (next as any).content?.source?.path;

        // Basic dirty check for HUD media
        if (
          clip.hudMediaStates?.background?.sourcePath !== nextBg ||
          clip.hudMediaStates?.content?.sourcePath !== nextContent
        ) {
          // We will recreate media states in loadTimeline on next pass if paths changed
          // For immediate layout updates we just copy the params
          clip.background = (next as any).background;
          clip.content = (next as any).content;
        }
      }
      const trackRuntime = this.getTrackRuntimeForClip(clip);
      if (trackRuntime && clip.sprite.parent !== trackRuntime.container) {
        trackRuntime.container.addChild(clip.sprite);
      }
      if (clip.clipKind === 'solid') {
        clip.backgroundColor = sanitizeTimelineColor(
          (next as any).backgroundColor,
          clip.backgroundColor ?? '#000000',
        );
        clip.sprite.tint = parseHexColor(clip.backgroundColor);
      }
      if (!clip.effectFilters) {
        clip.effectFilters = new Map();
      }
    }

    this.clips.sort((a, b) => a.startUs - b.startUs || a.layer - b.layer);
    this.rebuildPrevClipIndex();
    this.maxDurationUs = this.clips.length > 0 ? Math.max(0, ...this.clips.map((c) => c.endUs)) : 0;

    this.lastRenderedTimeUs = Number.NaN;
    this.activeTracker.reset();
    this.stageSortDirty = true;
    this.activeSortDirty = true;
    return this.maxDurationUs;
  }

  async renderFrame(
    timeUs: number,
    options?: PreviewRenderOptions,
  ): Promise<OffscreenCanvas | HTMLCanvasElement | null> {
    if (!this.app || !this.canvas || !this.app.renderer) return null;

    this.applyVideoFrameCacheLimit(options?.videoFrameCacheMb);

    if (timeUs !== this.lastRenderedTimeUs) {
      this.resourceManager.abortInFlight();
    }

    this.previewEffectsEnabled = options?.previewEffectsEnabled !== false;

    if (this.contextLost) {
      return null;
    }

    if (timeUs === this.lastRenderedTimeUs && !this.stageSortDirty && !this.activeSortDirty) {
      return this.canvas;
    }

    const updatedClips: CompositorClip[] = [];
    try {
      const { activeClips: active, activeChanged } = this.activeTracker.update({
        clips: this.clips,
        timeUs,
        lastTimeUs: this.lastRenderedTimeUs,
        onDeactivate: (clip) => {
          clip.sprite.visible = false;
        },
      });

      if (activeChanged) {
        this.activeSortDirty = true;
      }
      if (this.activeSortDirty) {
        active.sort((a, b) => a.layer - b.layer || a.startUs - b.startUs);
        this.activeSortDirty = false;
      }

      for (const track of this.tracks) {
        track.container.alpha = track.opacity ?? 1;
        track.container.blendMode = track.blendMode ?? 'normal';
        this.applyTrackEffects(track);
      }

      const sampleRequests: Array<Promise<{ clip: CompositorClip; sample: any | null }>> = [];

      for (const clip of active) {
        this.syncTransitionFilter(clip, timeUs);
        const effectiveOpacity = this.computeTransitionOpacity(clip, timeUs);
        clip.sprite.alpha = effectiveOpacity;
        clip.sprite.blendMode = clip.blendMode ?? 'normal';

        this.applyClipEffects(clip);

        if (clip.clipKind === 'image') {
          clip.sprite.visible = true;
          continue;
        }

        if (clip.clipKind === 'solid') {
          clip.sprite.visible = true;
          continue;
        }

        if (clip.clipKind === 'adjustment') {
          clip.sprite.visible = true;
          continue;
        }

        if (clip.clipKind === 'hud') {
          this.drawHudClip(clip);
          clip.sprite.visible = true;
          continue;
        }

        if (clip.clipKind === 'shape') {
          if (clip.shapeDirty) {
            this.shapeRenderer.draw({
              graphics: clip.sprite,
              type: clip.shapeType ?? 'square',
              fill: clip.fillColor ?? '#ffffff',
              stroke: clip.strokeColor ?? '#000000',
              strokeWidth: clip.strokeWidth ?? 0,
              config: clip.shapeConfig ?? {},
              canvasWidth: this.width,
              canvasHeight: this.height,
            });
            clip.shapeDirty = false;
          }
          clip.sprite.visible = true;
          continue;
        }

        if (clip.clipKind === 'text') {
          if (clip.textDirty) {
            this.textRenderer.draw(clip, this.width, this.height);
            this.applyTextLayout(clip);
            clip.textDirty = false;
          }
          clip.sprite.visible = true;
          continue;
        }

        const localTimeUs = timeUs - clip.startUs;
        const speedRaw = typeof clip.speed === 'number' && clip.speed !== 0 ? clip.speed : 1;
        const speed = Math.abs(speedRaw);
        const reversed = speedRaw < 0;
        if (localTimeUs < 0 || localTimeUs >= clip.durationUs) {
          clip.sprite.visible = false;
          continue;
        }

        const freezeUs = clip.freezeFrameSourceUs;

        // Calculate effective local time based on playback direction
        const effectiveLocalUs = reversed
          ? Math.max(0, clip.sourceRangeDurationUs - Math.round(localTimeUs * speed))
          : Math.round(localTimeUs * speed);

        let sampleTimeS =
          typeof freezeUs === 'number'
            ? Math.max(0, freezeUs) / 1_000_000
            : Math.max(0, clip.sourceStartUs + effectiveLocalUs) / 1_000_000;

        if (!Number.isFinite(sampleTimeS) || Number.isNaN(sampleTimeS)) {
          sampleTimeS = 0;
        }

        if (!clip.sink) {
          clip.sprite.visible = false;
          continue;
        }

        const abortController = this.resourceManager.createAbortController(
          clip.itemId + '_primary',
        );

        const request = this.getVideoSampleForClip({
          clip,
          sampleTimeS,
          abortSignal: abortController.signal,
        })
          .then((sample) => ({ clip, sample }))
          .catch((error) => {
            console.error('[VideoCompositor] Failed to render sample', error);
            return { clip, sample: null };
          });

        sampleRequests.push(request);
      }

      // --- Blend shadow rendering ---
      // Behaviour:
      //  - image / solid clips: always kept visible (infinite source)
      //  - video with handle material (sourceDurationUs > durationUs): seek into handle frames
      //  - video without handle material: freeze the last available frame
      const blendShadowRequests: Array<Promise<{ clip: CompositorClip; sample: any | null }>> = [];

      for (const clip of active) {
        const tr = clip.transitionIn;
        const mode = tr?.mode ?? DEFAULT_TRANSITION_MODE;
        if (!tr || mode !== 'adjacent' || tr.durationUs <= 0) continue;
        const localTimeUs = timeUs - clip.startUs;
        if (localTimeUs >= tr.durationUs) continue;

        const prevClip = this.findPrevClipOnLayer(clip);
        if (!prevClip || active.includes(prevClip)) continue;

        const manifest = getTransitionManifest(tr.type);
        const rawProgress = Math.max(0, Math.min(1, localTimeUs / tr.durationUs));
        const shadowAlpha = manifest
          ? manifest.computeOutOpacity(
              rawProgress,
              (normalizeTransitionParams(tr.type, tr.params) as any) ?? {},
              tr.curve ?? DEFAULT_TRANSITION_CURVE,
            )
          : 1 - rawProgress;

        prevClip.sprite.alpha = Math.max(0, Math.min(1, shadowAlpha));

        // Images and solid clips: keep visible indefinitely
        if (
          prevClip.clipKind === 'image' ||
          prevClip.clipKind === 'solid' ||
          prevClip.clipKind === 'shape' ||
          prevClip.clipKind === 'text' ||
          prevClip.clipKind === 'hud'
        ) {
          prevClip.sprite.visible = true;
          continue;
        }

        // Check if source media has frames beyond the clip's out-point (handle material)
        // handleUs = full media duration minus the used source end point
        const handleUs =
          prevClip.sourceDurationUs - prevClip.sourceStartUs - prevClip.sourceRangeDurationUs;
        if (!prevClip.sink) {
          prevClip.sprite.visible = false;
          continue;
        }

        if (handleUs < 1_000) {
          // No extra source material: freeze the last frame of the used source range.
          const lastUs =
            (prevClip.speed || 1) < 0
              ? Math.max(0, prevClip.sourceStartUs + 1_000)
              : Math.max(0, prevClip.sourceStartUs + prevClip.sourceRangeDurationUs - 1_000);
          const shadowSampleTimeS = Math.max(0, lastUs / 1_000_000);
          const abortController = this.resourceManager.createAbortController(
            prevClip.itemId + '_shadow_end',
          );
          const req = this.getVideoSampleForClip({
            clip: prevClip,
            sampleTimeS: shadowSampleTimeS,
            abortSignal: abortController.signal,
          })
            .then((sample) => ({ clip: prevClip, sample }))
            .catch(() => ({ clip: prevClip, sample: null }));
          blendShadowRequests.push(req);
          continue;
        }

        // Seek into handle material: frames past the source range end point
        const overrunUs = localTimeUs;
        const sourceRangeEndUs = prevClip.sourceStartUs + prevClip.sourceRangeDurationUs;

        let clampedUs: number;
        if ((prevClip.speed || 1) < 0) {
          clampedUs = Math.max(0, prevClip.sourceStartUs - overrunUs);
        } else {
          const handleSampleUs = sourceRangeEndUs + overrunUs;
          clampedUs = Math.min(
            handleSampleUs,
            prevClip.sourceStartUs + prevClip.sourceDurationUs - 1_000,
          );
        }

        const shadowSampleTimeS = Math.max(0, clampedUs / 1_000_000);
        const abortController = this.resourceManager.createAbortController(
          prevClip.itemId + '_shadow_overrun',
        );
        const req = this.getVideoSampleForClip({
          clip: prevClip,
          sampleTimeS: shadowSampleTimeS,
          abortSignal: abortController.signal,
        })
          .then((sample) => ({ clip: prevClip, sample }))
          .catch(() => ({ clip: prevClip, sample: null }));
        blendShadowRequests.push(req);
      }

      if (blendShadowRequests.length > 0) {
        const shadowSamples = await Promise.all(blendShadowRequests);
        for (const { clip, sample } of shadowSamples) {
          if (!sample) {
            clip.sprite.visible = false;
            continue;
          }
          try {
            await this.updateClipTextureFromSample(sample, clip);
            clip.sprite.visible = true;
            updatedClips.push(clip);
          } catch {
            clip.sprite.visible = false;
          } finally {
            if (typeof sample.close === 'function') {
              try {
                sample.close();
              } catch {
                /**/
              }
            }
          }
        }
      }

      // --- Composite mode: explicitly hide same-layer prev clip ---
      // In composite mode, the clip fades in over lower tracks only; prev clip on same layer must not show.
      for (const clip of active) {
        const tr = clip.transitionIn;
        const mode = tr?.mode ?? DEFAULT_TRANSITION_MODE;
        if (!tr || (mode !== 'background' && mode !== 'transparent') || tr.durationUs <= 0)
          continue;
        const localTimeUs = timeUs - clip.startUs;
        if (localTimeUs >= tr.durationUs) continue;
        const prevClip = this.findPrevClipOnLayer(clip);
        if (prevClip && !active.includes(prevClip)) {
          prevClip.sprite.visible = false;
        }
      }

      if (sampleRequests.length > 0) {
        const samples = await Promise.all(sampleRequests);
        for (const { clip, sample } of samples) {
          if (!sample) {
            clip.sprite.visible = false;
            continue;
          }
          try {
            await this.updateClipTextureFromSample(sample, clip);
            clip.sprite.visible = true;
            updatedClips.push(clip);
          } catch (error) {
            console.error('[VideoCompositor] Failed to update clip texture', error);
            clip.sprite.visible = false;
          } finally {
            if (typeof sample.close === 'function') {
              try {
                sample.close();
              } catch (err) {
                console.error('[VideoCompositor] Failed to close VideoSample', err);
              }
            }
          }
        }
      }

      if (!this.app || !this.canvas || !this.app.renderer) {
        return null;
      }

      if (this.stageSortDirty) {
        this.sortTrackContainerChildren();
        this.app.stage.children.sort((a: any, b: any) => {
          const aTrack = this.trackById.get((a as any).__trackId ?? '') as any;
          const bTrack = this.trackById.get((b as any).__trackId ?? '') as any;
          const aLayer = typeof aTrack?.layer === 'number' ? aTrack.layer : 0;
          const bLayer = typeof bTrack?.layer === 'number' ? bTrack.layer : 0;
          return aLayer - bLayer;
        });
        this.stageSortDirty = false;
      }

      this.prepareAdjustmentClips(active);

      await this.applyShaderTransitions(active, timeUs);

      if (!this.app || !this.canvas || !this.app.renderer) {
        return null;
      }

      this.lastRenderedTimeUs = timeUs;

      this.applyMasterEffects();

      if (this.app.renderer) {
        this.app.renderer.render(this.app.stage);
      }

      return this.canvas;
    } finally {
      // Ensure VideoFrames are always closed even when rendering fails.
      for (const clip of updatedClips) {
        if (!clip.lastVideoFrame) continue;
        safeDispose(clip.lastVideoFrame);
        clip.lastVideoFrame = null;
      }
    }
  }

  /** Find the clip on the same layer immediately adjacent to `clip` (for blend shadow rendering).
   *  Returns null if there is a gap larger than the configured threshold. */
  private findPrevClipOnLayer(clip: CompositorClip): CompositorClip | null {
    const best = this.prevClipById.get(clip.itemId) ?? null;
    if (!best) return null;
    if (clip.startUs - best.endUs > VIDEO_CORE_LIMITS.BLEND_SHADOW_GAP_THRESHOLD_US) return null;
    return best;
  }

  private ensureTransitionRenderTexture(texture: RenderTexture | null): RenderTexture {
    const valid =
      texture &&
      !(texture as any).destroyed &&
      typeof (texture as any).uid === 'number' &&
      texture.width === this.width &&
      texture.height === this.height;

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
      width: this.width,
      height: this.height,
    });
  }

  private ensureCombinedTransitionRenderTexture(texture: RenderTexture | null): RenderTexture {
    const valid =
      texture &&
      !(texture as any).destroyed &&
      typeof (texture as any).uid === 'number' &&
      texture.width === this.width * 2 &&
      texture.height === this.height;

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
      width: this.width * 2,
      height: this.height,
    });
  }

  private renderCombinedTransitionTexture(
    fromTexture: RenderTexture,
    toTexture: RenderTexture,
    combined: RenderTexture,
  ): void {
    if (!this.app?.renderer) return;

    if (!this.transitionCombineSprite) {
      this.transitionCombineSprite = new Sprite(Texture.EMPTY);
      this.transitionCombineSprite.anchor.set(0, 0);
    }

    const renderer = this.app.renderer;

    this.transitionCombineSprite.texture = fromTexture;
    this.transitionCombineSprite.x = 0;
    this.transitionCombineSprite.y = 0;
    this.transitionCombineSprite.scale.set(1, 1);
    this.transitionCombineSprite.width = this.width;
    this.transitionCombineSprite.height = this.height;
    renderer.render({ container: this.transitionCombineSprite, target: combined, clear: true });

    this.transitionCombineSprite.texture = toTexture;
    this.transitionCombineSprite.x = this.width;
    this.transitionCombineSprite.y = 0;
    this.transitionCombineSprite.scale.set(1, 1);
    this.transitionCombineSprite.width = this.width;
    this.transitionCombineSprite.height = this.height;
    renderer.render({ container: this.transitionCombineSprite, target: combined, clear: false });
  }

  private ensureTransitionSprite(clip: CompositorClip): Sprite {
    let sprite = clip.transitionSprite ?? null;
    if (!sprite) {
      sprite = new Sprite(Texture.EMPTY);
      (sprite as any).__clipId = clip.itemId;
      (sprite as any).__clipOrder = 1;
      sprite.visible = false;
      clip.transitionSprite = sprite;
    }

    const parent = clip.sprite.parent;
    if (parent && sprite.parent !== parent) {
      parent.addChild(sprite);
    }

    sprite.x = 0;
    sprite.y = 0;
    sprite.anchor.set(0, 0);
    sprite.scale.set(1, 1);
    sprite.width = this.width;
    sprite.height = this.height;

    return sprite;
  }

  private renderDisplayObjectToTexture(displayObject: Container, texture: RenderTexture) {
    if (!this.app?.renderer) return;
    this.app.renderer.render({
      container: displayObject,
      target: texture,
      clear: true,
    });
  }

  private renderDisplayObjectToTextureForcedVisible(
    displayObject: Container,
    texture: RenderTexture,
  ) {
    const previousVisible = displayObject.visible;
    displayObject.visible = true;
    try {
      this.renderDisplayObjectToTexture(displayObject, texture);
    } finally {
      displayObject.visible = previousVisible;
    }
  }

  private renderSingleClipToTexture(
    clip: CompositorClip,
    texture: RenderTexture,
    forceVisible = false,
  ) {
    if (!this.app?.renderer) return;

    const stageChildren = this.app.stage.children;
    const stagePrev = stageChildren.map((child) => child.visible);

    // Hide all track containers except the one owning this clip.
    for (let i = 0; i < stageChildren.length; i++) {
      const child = stageChildren[i] as any;
      if (!child) continue;
      const track = this.trackById.get(child?.__trackId ?? '');
      child.visible = track?.id === clip.trackId;
    }

    // Within the clip's track container, hide all sibling sprites except this clip's sprite.
    const trackContainer = this.trackById.get(clip.trackId ?? '')?.container ?? null;
    const containerChildren = trackContainer ? [...trackContainer.children] : [];
    const containerPrev = containerChildren.map((c) => c.visible);
    for (const c of containerChildren) {
      (c as any).visible = c === clip.sprite;
    }

    const previousClipVisible = clip.sprite.visible;
    if (forceVisible) {
      clip.sprite.visible = true;
    }

    this.app.renderer.render({
      container: this.app.stage,
      target: texture,
      clear: true,
    });

    clip.sprite.visible = previousClipVisible;

    for (let i = 0; i < containerChildren.length; i++) {
      (containerChildren[i] as any).visible = containerPrev[i] ?? true;
    }
    for (let i = 0; i < stageChildren.length; i++) {
      const child = stageChildren[i];
      if (!child) continue;
      child.visible = stagePrev[i] ?? true;
    }
  }

  private renderLowerLayersToTexture(layer: number, texture: RenderTexture) {
    if (!this.app?.renderer) return;

    const children = this.app.stage.children;
    const previous = children.map((child) => child.visible);

    for (let i = 0; i < children.length; i++) {
      const child = children[i] as any;
      if (!child) continue;
      const track = this.trackById.get(child?.__trackId ?? '');
      const childLayer = typeof track?.layer === 'number' ? track.layer : Number.POSITIVE_INFINITY;
      child.visible = childLayer < layer;
    }

    this.app.renderer.render({
      container: this.app.stage,
      target: texture,
      clear: true,
    });

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (!child) continue;
      child.visible = previous[i] ?? true;
    }
  }

  private async renderTransitionClipToTexture(
    clip: CompositorClip,
    texture: RenderTexture,
    options?: { transitionOffsetUs?: number },
  ): Promise<boolean> {
    if (
      clip.clipKind === 'image' ||
      clip.clipKind === 'solid' ||
      clip.clipKind === 'text' ||
      clip.clipKind === 'shape'
    ) {
      this.renderSingleClipToTexture(clip, texture);
      return true;
    }

    if (clip.clipKind === 'adjustment') {
      return false;
    }

    if (!clip.sink) {
      return false;
    }

    const transitionOffsetUs = Math.max(0, Math.round(options?.transitionOffsetUs ?? 0));
    const handleUs = Math.max(
      0,
      clip.sourceDurationUs - clip.sourceStartUs - clip.sourceRangeDurationUs,
    );
    const sourceRangeEndUs = clip.sourceStartUs + clip.sourceRangeDurationUs;

    let sampleUs: number;
    if ((clip.speed || 1) < 0) {
      // In reverse, "overrun" goes before sourceStartUs
      sampleUs =
        handleUs < 1_000
          ? Math.max(0, clip.sourceStartUs + 1_000)
          : Math.max(0, clip.sourceStartUs - transitionOffsetUs);
    } else {
      sampleUs =
        handleUs < 1_000
          ? Math.max(0, clip.sourceStartUs + clip.sourceRangeDurationUs - 1_000)
          : Math.min(
              sourceRangeEndUs + transitionOffsetUs,
              clip.sourceStartUs + clip.sourceDurationUs - 1_000,
            );
    }

    const abortController = this.resourceManager.createAbortController(
      clip.itemId + '_transition_texture',
    );
    const sample = await this.getVideoSampleForClip({
      clip,
      sampleTimeS: sampleUs / 1_000_000,
      abortSignal: abortController.signal,
    });

    // Fallback: If no sample due to lacking handles, but we have a valid last frame, use it
    if (!sample) {
      if (clip.lastVideoFrame) {
        try {
          await this.updateClipTextureFromSample(
            { frame: clip.lastVideoFrame, close: () => {} } as any,
            clip,
          );
          clip.sprite.visible = true;
          this.renderSingleClipToTexture(clip, texture);
          return true;
        } catch {
          return false;
        }
      }
      return false;
    }

    try {
      await this.updateClipTextureFromSample(sample, clip);
      clip.sprite.visible = true;
      this.renderSingleClipToTexture(clip, texture);
      return true;
    } catch {
      return false;
    } finally {
      if (typeof (sample as any).close === 'function') {
        try {
          (sample as any).close();
        } catch (err) {
          console.error(
            '[VideoCompositor] Failed to close VideoSample in renderClipToTextureForTransition',
            err,
          );
        }
      }
    }
  }

  private async applyShaderTransitions(active: CompositorClip[], timeUs: number) {
    for (const clip of this.clips) {
      if (clip.transitionSprite) {
        clip.transitionSprite.visible = false;
        clip.transitionSprite.filters = null;
      }
    }

    for (const clip of active) {
      const state = this.getActiveTransitionState(clip, timeUs);
      if (!state || state.manifest?.renderMode !== 'shader' || !clip.transitionFilter) {
        continue;
      }

      const transitionFilter = this.ensureUsableTransitionFilter(clip, state.manifest);
      if (!transitionFilter) {
        continue;
      }

      const mode = state.transition.mode ?? DEFAULT_TRANSITION_MODE;
      if (mode !== 'adjacent' && mode !== 'background' && mode !== 'transparent') {
        continue;
      }

      clip.transitionFromTexture = this.ensureTransitionRenderTexture(
        clip.transitionFromTexture ?? null,
      );
      clip.transitionToTexture = this.ensureTransitionRenderTexture(
        clip.transitionToTexture ?? null,
      );
      clip.transitionOutputTexture = this.ensureTransitionRenderTexture(
        clip.transitionOutputTexture ?? null,
      );

      // Hide the clip on the main stage before taking its snapshot and before lower layers render
      const prevClipVisible = clip.sprite.visible;
      clip.sprite.visible = false;

      this.renderSingleClipToTexture(clip, clip.transitionToTexture, true);

      const fromTexture = clip.transitionFromTexture;
      let prevClip: CompositorClip | null = null;

      if (mode === 'background') {
        this.renderLowerLayersToTexture(clip.layer, fromTexture);
      } else if (mode === 'transparent') {
        this.renderLowerLayersToTexture(Number.NEGATIVE_INFINITY, fromTexture);
      } else {
        prevClip = this.findPrevClipOnLayer(clip);
        if (!prevClip) {
          continue;
        }
        const transitionOffsetUs = Math.max(0, timeUs - clip.startUs);
        const rendered = await this.renderTransitionClipToTexture(prevClip, fromTexture, {
          transitionOffsetUs,
        });
        if (!rendered) {
          continue;
        }
      }

      const transitionContext = {
        progress: state.progress,
        curve: state.curve,
        elapsedUs: timeUs - clip.startUs,
        durationUs: state.transition.durationUs,
        edge: 'in' as const,
        params: state.transition.params,
        fromTexture,
        toTexture: clip.transitionToTexture,
      };

      const filterUpdated = this.updateTransitionFilterSafely(
        clip,
        state.manifest,
        transitionFilter,
        transitionContext,
      );
      if (!filterUpdated) {
        continue;
      }

      if (!this.filterQuadSprite) {
        this.filterQuadSprite = new Sprite(Texture.EMPTY);
        this.filterQuadSprite.x = 0;
        this.filterQuadSprite.y = 0;
        this.filterQuadSprite.anchor.set(0, 0);
      }
      this.filterQuadSprite.texture = clip.transitionToTexture;
      this.filterQuadSprite.scale.set(1, 1);
      this.filterQuadSprite.width = this.width;
      this.filterQuadSprite.height = this.height;
      this.filterQuadSprite.filters = [filterUpdated];

      this.app!.renderer.render({
        container: this.filterQuadSprite,
        target: clip.transitionOutputTexture!,
        clear: true,
      });

      const transitionSprite = this.ensureTransitionSprite(clip);
      transitionSprite.texture = clip.transitionOutputTexture!;
      transitionSprite.scale.set(1, 1);
      transitionSprite.width = this.width;
      transitionSprite.height = this.height;
      transitionSprite.alpha = 1;
      transitionSprite.blendMode = clip.blendMode ?? 'normal';
      transitionSprite.filters = null;
      transitionSprite.visible = true;

      clip.sprite.visible = false;
      if (prevClip) {
        prevClip.sprite.visible = false;
      }

      // Now that the transition is rendered onto the transitionSprite and added to the stage,
      // we must hide the original background layers on the stage so they don't double-render
      // behind the transition sprite (since the transition sprite already contains them).
      if (mode === 'background') {
        const children = this.app!.stage.children;
        for (let i = 0; i < children.length; i++) {
          const child = children[i] as any;
          if (!child || child === transitionSprite) continue;

          const track = this.trackById.get(child?.__trackId ?? '');
          const childLayer =
            typeof track?.layer === 'number' ? track.layer : Number.POSITIVE_INFINITY;
          if (childLayer < clip.layer) {
            child.visible = false;
          }
        }
      }
    }
  }

  private ensureUsableTransitionFilter(clip: CompositorClip, manifest: any): Filter | null {
    const currentFilter = clip.transitionFilter;
    if (this.isTransitionFilterUsable(currentFilter)) {
      return currentFilter;
    }

    return this.recreateTransitionFilter(clip, manifest);
  }

  private isTransitionFilterUsable(filter: Filter | null | undefined): filter is Filter {
    if (!filter) {
      return false;
    }

    const candidate = filter as any;
    if (candidate.destroyed) {
      return false;
    }

    return candidate.resources != null && Object.keys(candidate.resources).length > 0;
  }

  private recreateTransitionFilter(clip: CompositorClip, manifest: any): Filter | null {
    if (clip.transitionFilter) {
      try {
        clip.transitionFilter.destroy();
      } catch {
        // ignore
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
      this.transitionFilters.set(clip.itemId, filter);
      return filter;
    } catch (error) {
      console.error('[VideoCompositor] Failed to recreate transition filter', error);
      clip.transitionFilterType = null;
      return null;
    }
  }

  private updateTransitionFilterSafely(
    clip: CompositorClip,
    manifest: any,
    filter: Filter,
    context: any,
  ): Filter | null {
    const applyUpdate = (candidate: Filter) => {
      manifest.updateFilter?.(candidate, context);
      return candidate;
    };

    try {
      return applyUpdate(filter);
    } catch (error) {
      console.error('[VideoCompositor] Failed to update transition filter', error);
    }

    const recreatedFilter = this.recreateTransitionFilter(clip, manifest);
    if (!recreatedFilter) {
      return null;
    }

    try {
      return applyUpdate(recreatedFilter);
    } catch (error) {
      console.error('[VideoCompositor] Failed to update recreated transition filter', error);
      return null;
    }
  }

  private ensureCanvasFallback(clip: CompositorClip) {
    if (clip.canvas && clip.ctx) return;
    const clipCanvas = new OffscreenCanvas(2, 2);
    const clipCtx = clipCanvas.getContext('2d');
    if (!clipCtx) {
      throw new Error('Failed to create 2D rendering context for clip canvas');
    }
    clip.canvas = clipCanvas;
    clip.ctx = clipCtx;
    const canvasSource = new CanvasSource({ resource: clipCanvas as any });
    clip.sprite.texture.source = canvasSource as any;
    clip.sourceKind = 'canvas';
  }

  private applySolidLayout(clip: CompositorClip) {
    const layout = computeClipBoxLayout({
      frameWidth: this.width,
      frameHeight: this.height,
      canvasWidth: this.width,
      canvasHeight: this.height,
      transform: clip.transform,
    });

    this.applyTransformLayout({
      clip,
      baseX: layout.baseX,
      baseY: layout.baseY,
      targetW: layout.targetWidth,
      targetH: layout.targetHeight,
      anchorOffsetX: layout.anchorOffsetX,
      anchorOffsetY: layout.anchorOffsetY,
      normalizedAnchor: { x: layout.anchorX, y: layout.anchorY },
      scaleX: layout.scaleX,
      scaleY: layout.scaleY,
      rotationDeg: layout.rotationDeg,
      stagePosX: layout.stagePositionX,
      stagePosY: layout.stagePositionY,
    });
  }

  private applyScreenSpaceLayout(
    clip: CompositorClip,
    baseX: number,
    baseY: number,
    targetW: number,
    targetH: number,
  ) {
    const transform = clip.transform;
    const scaleX = typeof transform?.scale?.x === 'number' ? transform.scale.x : 1;
    const scaleY = typeof transform?.scale?.y === 'number' ? transform.scale.y : 1;
    const rotationDeg = typeof transform?.rotationDeg === 'number' ? transform.rotationDeg : 0;
    const positionX = typeof transform?.position?.x === 'number' ? transform.position.x : 0;
    const positionY = typeof transform?.position?.y === 'number' ? transform.position.y : 0;

    const stageScaleX = this.width / TRANSFORM_DESIGN_BASE.width;
    const stageScaleY = this.height / TRANSFORM_DESIGN_BASE.height;
    const stagePosX = positionX * stageScaleX;
    const stagePosY = positionY * stageScaleY;

    const normalizedAnchor = resolveNormalizedAnchor(transform?.anchor);
    const anchorOffsetX = normalizedAnchor.x * targetW;
    const anchorOffsetY = normalizedAnchor.y * targetH;

    this.applyTransformLayout({
      clip,
      baseX,
      baseY,
      targetW,
      targetH,
      anchorOffsetX,
      anchorOffsetY,
      normalizedAnchor,
      scaleX,
      scaleY,
      rotationDeg,
      stagePosX,
      stagePosY,
    });
  }

  private applyShapeLayout(clip: CompositorClip) {
    const size = Math.min(this.width, this.height) * 0.8;
    const strokeWidth = clip.strokeWidth ?? 0;
    const targetW = Math.max(1, Math.ceil(size + strokeWidth * 2));
    const targetH = Math.max(1, Math.ceil(size + strokeWidth * 2));
    const baseX = (this.width - targetW) / 2;
    const baseY = (this.height - targetH) / 2;

    this.applyScreenSpaceLayout(clip, baseX, baseY, targetW, targetH);
  }

  private applyTextLayout(clip: CompositorClip) {
    if (!clip.ctx) return;
    const layout = computeTextLayoutMetrics({
      text: String(clip.text ?? ''),
      style: clip.style,
      canvasWidth: this.width,
      canvasHeight: this.height,
      measureText: (text, font) => {
        clip.ctx!.font = font;
        return clip.ctx!.measureText(text).width;
      },
    });

    const w = Math.max(1, Math.ceil(layout.backgroundWidth));
    const h = Math.max(1, Math.ceil(layout.backgroundHeight));
    const baseX = layout.backgroundX;
    const baseY = layout.backgroundY;

    this.applyScreenSpaceLayout(clip, baseX, baseY, w, h);
  }

  private applyClipLayoutForCurrentSource(clip: CompositorClip) {
    if (clip.clipKind === 'text') {
      this.applyTextLayout(clip);
      return;
    }
    if (clip.clipKind === 'shape') {
      this.applyShapeLayout(clip);
      return;
    }
    if (clip.clipKind === 'solid' || clip.clipKind === 'adjustment' || clip.clipKind === 'hud') {
      this.applySolidLayout(clip);
      return;
    }

    const frameW = Math.max(1, Math.round(clip.imageSource?.width ?? 1));
    const frameH = Math.max(1, Math.round(clip.imageSource?.height ?? 1));
    this.applySpriteLayout(frameW, frameH, clip);
  }

  private computeTransitionOpacity(clip: CompositorClip, timeUs: number): number {
    const baseOpacity = clip.opacity ?? 1;
    const localTimeUs = timeUs - clip.startUs;
    let opacity = baseOpacity;

    if (!this.previewEffectsEnabled) {
      if (clip.transitionIn && clip.transitionIn.durationUs > 0) {
        const dur = clip.transitionIn.durationUs;
        if (localTimeUs < dur) {
          const rawProgress = Math.max(0, Math.min(1, localTimeUs / dur));
          opacity = Math.min(opacity, baseOpacity * rawProgress);
        }
      }

      if (clip.transitionOut && clip.transitionOut.durationUs > 0) {
        const dur = clip.transitionOut.durationUs;
        const outStartUs = clip.durationUs - dur;
        if (localTimeUs >= outStartUs) {
          const rawProgress = Math.max(0, Math.min(1, (localTimeUs - outStartUs) / dur));
          opacity = Math.min(opacity, baseOpacity * (1 - rawProgress));
        }
      }

      return Math.max(0, Math.min(1, opacity));
    }

    if (clip.transitionIn && clip.transitionIn.durationUs > 0) {
      const dur = clip.transitionIn.durationUs;
      const curve = clip.transitionIn.curve ?? DEFAULT_TRANSITION_CURVE;
      // In composite mode the clip fades from the lower track composition — opacity still applies
      if (localTimeUs < dur) {
        const manifest = getTransitionManifest(clip.transitionIn.type);
        if (manifest && manifest.renderMode !== 'shader') {
          const rawProgress = Math.max(0, Math.min(1, localTimeUs / dur));
          const params = normalizeTransitionParams(
            clip.transitionIn.type,
            clip.transitionIn.params,
          );
          opacity = Math.min(
            opacity,
            baseOpacity * manifest.computeInOpacity(rawProgress, (params as any) ?? {}, curve),
          );
        }
      }
    }

    if (clip.transitionOut && clip.transitionOut.durationUs > 0) {
      const dur = clip.transitionOut.durationUs;
      const curve = clip.transitionOut.curve ?? DEFAULT_TRANSITION_CURVE;
      const clipDurUs = clip.durationUs;
      const outStartUs = clipDurUs - dur;
      if (localTimeUs >= outStartUs) {
        const manifest = getTransitionManifest(clip.transitionOut.type);
        if (manifest && manifest.renderMode !== 'shader') {
          const rawProgress = Math.max(0, Math.min(1, (localTimeUs - outStartUs) / dur));
          const params = normalizeTransitionParams(
            clip.transitionOut.type,
            clip.transitionOut.params,
          );
          opacity = Math.min(
            opacity,
            baseOpacity * manifest.computeOutOpacity(rawProgress, (params as any) ?? {}, curve),
          );
        }
      }
    }

    return Math.max(0, Math.min(1, opacity));
  }

  private getActiveTransitionState(clip: CompositorClip, timeUs: number) {
    const transition = clip.transitionIn;
    if (!transition || transition.durationUs <= 0) return null;

    const localTimeUs = timeUs - clip.startUs;
    if (localTimeUs < 0 || localTimeUs >= transition.durationUs) return null;

    const progress = Math.max(0, Math.min(1, localTimeUs / transition.durationUs));
    const manifest = this.previewEffectsEnabled ? getTransitionManifest(transition.type) : null;

    return {
      transition,
      manifest,
      progress,
      curve: transition.curve ?? DEFAULT_TRANSITION_CURVE,
    };
  }

  private syncTransitionFilter(clip: CompositorClip, timeUs: number) {
    if (!this.previewEffectsEnabled) {
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

    const state = this.getActiveTransitionState(clip, timeUs);
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
    try {
      // Prefer WebCodecs VideoFrame path (GPU-friendly upload).
      if (typeof sample?.toVideoFrame === 'function') {
        if (clip.lastVideoFrame) {
          safeDispose(clip.lastVideoFrame);
          clip.lastVideoFrame = null;
        }

        const frame = sample.toVideoFrame() as VideoFrame;
        clip.lastVideoFrame = frame;

        const frameW = Math.max(
          1,
          Math.round((frame as any).displayWidth ?? (frame as any).codedWidth ?? 1),
        );
        const frameH = Math.max(
          1,
          Math.round((frame as any).displayHeight ?? (frame as any).codedHeight ?? 1),
        );

        if (clip.sourceKind !== 'videoFrame') {
          // Restore ImageSource-based texture
          clip.sprite.texture.source = clip.imageSource as any;
          clip.sourceKind = 'videoFrame';
        }

        if (clip.imageSource.width !== frameW || clip.imageSource.height !== frameH) {
          clip.imageSource.resize(frameW, frameH);
        }

        // Assign the new frame as the resource and mark for upload.
        (clip.imageSource as any).resource = frame as any;
        clip.imageSource.update();

        // Layout on stage
        this.applySpriteLayout(frameW, frameH, clip);

        return;
      }
    } catch (err) {
      console.warn('[VideoCompositor] VideoFrame path failed, falling back to canvas:', err);
    }

    // Fallback: draw into 2D canvas and upload.
    await this.drawSampleToCanvas(sample, clip);
  }

  private applySpriteLayout(frameW: number, frameH: number, clip: CompositorClip) {
    const layout = computeClipBoxLayout({
      frameWidth: frameW,
      frameHeight: frameH,
      canvasWidth: this.width,
      canvasHeight: this.height,
      transform: clip.transform,
    });

    this.applyTransformLayout({
      clip,
      baseX: layout.baseX,
      baseY: layout.baseY,
      targetW: layout.targetWidth,
      targetH: layout.targetHeight,
      anchorOffsetX: layout.anchorOffsetX,
      anchorOffsetY: layout.anchorOffsetY,
      normalizedAnchor: { x: layout.anchorX, y: layout.anchorY },
      scaleX: layout.scaleX,
      scaleY: layout.scaleY,
      rotationDeg: layout.rotationDeg,
      stagePosX: layout.stagePositionX,
      stagePosY: layout.stagePositionY,
    });
  }

  private applyTransformLayout(input: {
    clip: CompositorClip;
    baseX: number;
    baseY: number;
    targetW: number;
    targetH: number;
    anchorOffsetX: number;
    anchorOffsetY: number;
    normalizedAnchor: { x: number; y: number };
    scaleX: number;
    scaleY: number;
    rotationDeg: number;
    stagePosX: number;
    stagePosY: number;
  }) {
    const sprite = input.clip.sprite;
    if (!sprite) return;

    sprite.anchor?.set?.(input.normalizedAnchor.x, input.normalizedAnchor.y);
    sprite.width = input.targetW;
    sprite.height = input.targetH;

    if (sprite.scale) {
      sprite.scale.x = Math.abs(sprite.scale.x) * input.scaleX;
      sprite.scale.y = Math.abs(sprite.scale.y) * input.scaleY;
    }

    sprite.rotation = (input.rotationDeg * Math.PI) / 180;
    sprite.x = input.baseX + input.anchorOffsetX + input.stagePosX;
    sprite.y = input.baseY + input.anchorOffsetY + input.stagePosY;
  }

  private drawHudClip(clip: CompositorClip) {
    if (clip.clipKind !== 'hud') return;
    if (!clip.canvas || !clip.ctx) return;

    const ctx = clip.ctx;
    const canvas = clip.canvas;

    const targetW = Math.max(1, Math.round(this.width));
    const targetH = Math.max(1, Math.round(this.height));
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
      try {
        if (typeof (clip.sprite.texture.source as any)?.resize === 'function') {
          (clip.sprite.texture.source as any).resize(targetW, targetH);
        }
      } catch {
        // ignore
      }
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Default fallback simple rendering for "media_frame"
    const type = clip.hudType ?? 'media_frame';

    if (type === 'media_frame') {
      const padding = Math.min(canvas.width, canvas.height) * 0.05;

      // Draw background if available
      const bgState = clip.hudMediaStates?.background;
      if (bgState && bgState.bitmap) {
        // Draw background filling the whole canvas (or fitting it)
        ctx.drawImage(bgState.bitmap, 0, 0, canvas.width, canvas.height);
      } else {
        // Fallback default background
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      // Draw content if available inside the frame
      const contentState = clip.hudMediaStates?.content;
      if (contentState && contentState.bitmap) {
        // Example: scale content to fit inside padding
        const cw = canvas.width - padding * 2;
        const ch = canvas.height - padding * 2;

        ctx.drawImage(contentState.bitmap, padding, padding, cw, ch);

        // Draw a neat frame around it
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4;
        ctx.strokeRect(padding, padding, cw, ch);
      } else {
        // Fallback placeholder content
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4;
        ctx.strokeRect(padding, padding, canvas.width - padding * 2, canvas.height - padding * 2);

        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 48px sans-serif';
        ctx.fillText('NO CONTENT', canvas.width / 2, canvas.height / 2);
      }
    }

    try {
      (clip.sprite.texture.source as any)?.update?.();
    } catch {
      // ignore
    }
  }

  private async drawSampleToCanvas(sample: any, clip: CompositorClip) {
    this.ensureCanvasFallback(clip);
    const ctx = clip.ctx;
    const canvas = clip.canvas;
    if (!ctx || !canvas) return;

    let imageSource: any;
    try {
      imageSource =
        typeof sample.toCanvasImageSource === 'function' ? sample.toCanvasImageSource() : sample;
      const frameW = Math.max(1, Math.round(imageSource?.displayWidth ?? imageSource?.width ?? 1));
      const frameH = Math.max(
        1,
        Math.round(imageSource?.displayHeight ?? imageSource?.height ?? 1),
      );

      if (canvas.width !== frameW || canvas.height !== frameH) {
        canvas.width = frameW;
        canvas.height = frameH;
        if (typeof clip.sprite.texture.source.resize === 'function') {
          clip.sprite.texture.source.resize(frameW, frameH);
        }
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const preferBitmap = this.clipPreferBitmapFallback.get(clip.itemId) === true;

      try {
        if (preferBitmap) {
          throw new Error('Prefer createImageBitmap fallback');
        }
        ctx.drawImage(imageSource, 0, 0, frameW, frameH);
        this.applySpriteLayout(frameW, frameH, clip);
        clip.sprite.texture.source.update();
        return;
      } catch (err) {
        this.clipPreferBitmapFallback.set(clip.itemId, true);
        console.warn('[VideoCompositor] drawImage failed, trying createImageBitmap fallback:', err);
        try {
          const bmp = await createImageBitmap(imageSource);
          ctx.drawImage(bmp, 0, 0, frameW, frameH);
          this.applySpriteLayout(frameW, frameH, clip);
          clip.sprite.texture.source.update();
          bmp.close();
          return;
        } catch (innerErr) {
          console.error('[VideoCompositor] Fallback createImageBitmap failed:', innerErr);
          throw innerErr;
        }
      }
    } catch (err) {
      console.error('[VideoCompositor] drawSampleToCanvas failed to draw image:', err);
    }

    if (typeof sample.draw === 'function') {
      try {
        sample.draw(ctx, 0, 0, canvas.width, canvas.height);
        clip.sprite.texture.source.update();
      } catch (err) {
        console.error('[VideoCompositor] sample.draw failed:', err);
      }
      return;
    }
  }

  clearClips() {
    this.clearVideoFrameCache();
    for (const clip of this.clips) {
      this.destroyClip(clip);
    }
    for (const filter of this.transitionFilters.values()) {
      try {
        filter.destroy();
      } catch {
        // ignore
      }
    }
    this.transitionFilters.clear();
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
    this.clearVideoFrameCache();
    if (this.filterQuadSprite) {
      this.filterQuadSprite.destroy();
      this.filterQuadSprite = null;
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
    this.clearVideoFrameCacheForClip(clip.itemId);
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
    if (clip.transitionFilter) {
      try {
        clip.transitionFilter.destroy();
      } catch {
        // ignore
      }
      this.transitionFilters.delete(clip.itemId);
      clip.transitionFilter = null;
    }
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
    clip.sprite.destroy(true);
  }
}
