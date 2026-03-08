import { safeDispose } from './utils';
import { getMediaTypeFromFilename } from '../media-types';
import { TimelineActiveTracker } from './TimelineActiveTracker';
import { isSvgFile } from '../svg';
import type { Filter } from 'pixi.js';
import {
  Application,
  Sprite,
  Texture,
  CanvasSource,
  ImageSource,
  DOMAdapter,
  WebWorkerAdapter,
  RenderTexture,
  Container,
} from 'pixi.js';
import type { Input, VideoSampleSink } from 'mediabunny';
import { getEffectManifest } from '../../effects';
import {
  DEFAULT_TRANSITION_CURVE,
  DEFAULT_TRANSITION_MODE,
  getTransitionManifest,
  normalizeTransitionParams,
} from '~/transitions';
import type { PreviewRenderOptions } from './worker-rpc';
import { computeClipBoxLayout, TRANSFORM_DESIGN_BASE } from './clip-layout';
import { computeTextLayoutMetrics } from './text-layout';
import type {
  TextClipStyle,
  ClipEffect,
  ClipTransform,
  ClipTransition,
  TimelineBlendMode,
} from '~/timeline/types';
import { VIDEO_CORE_LIMITS } from '../constants';

function resolveBlendMode(value: unknown): TimelineBlendMode {
  return value === 'add' ||
    value === 'multiply' ||
    value === 'screen' ||
    value === 'darken' ||
    value === 'lighten'
    ? value
    : 'normal';
}

function isEdgePadding(
  value: TextClipStyle['padding'],
): value is Extract<
  TextClipStyle['padding'],
  { top?: number; right?: number; bottom?: number; left?: number }
> {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    ('top' in value || 'right' in value || 'bottom' in value || 'left' in value)
  );
}

function arePaddingValuesEqual(a: TextClipStyle['padding'], b: TextClipStyle['padding']): boolean {
  if (a === b) return true;
  if (typeof a === 'number' || typeof b === 'number') {
    return a === b;
  }
  if (!a || !b) return !a && !b;
  if (!isEdgePadding(a) || !isEdgePadding(b)) return false;
  return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;
}

function areTextClipStylesEqual(a?: TextClipStyle, b?: TextClipStyle): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;

  return (
    a.width === b.width &&
    a.fontFamily === b.fontFamily &&
    a.fontSize === b.fontSize &&
    a.fontWeight === b.fontWeight &&
    a.color === b.color &&
    a.align === b.align &&
    a.verticalAlign === b.verticalAlign &&
    a.lineHeight === b.lineHeight &&
    a.letterSpacing === b.letterSpacing &&
    a.backgroundColor === b.backgroundColor &&
    arePaddingValuesEqual(a.padding, b.padding)
  );
}

export async function getVideoSampleWithZeroFallback(
  sink: Pick<VideoSampleSink, 'getSample'>,
  timeS: number,
  firstTimestampS?: number,
): Promise<unknown | null> {
  const primary = await sink.getSample(timeS).catch((e) => {
    const msg = String((e as any)?.message ?? e ?? '');
    const name = String((e as any)?.name ?? '');
    if (name === 'InputDisposedError' || msg.includes('Input has been disposed')) {
      return null;
    }
    throw e;
  });
  if (primary) return primary;

  if (Number.isFinite(firstTimestampS) && typeof firstTimestampS === 'number') {
    const safeFirst = Math.max(0, firstTimestampS);
    if (timeS <= safeFirst) {
      const first = await sink.getSample(safeFirst).catch((e) => {
        const msg = String((e as any)?.message ?? e ?? '');
        const name = String((e as any)?.name ?? '');
        if (name === 'InputDisposedError' || msg.includes('Input has been disposed')) {
          return null;
        }
        throw e;
      });
      if (first) return first;
    }
  }

  if (timeS !== 0) {
    return null;
  }

  // Some decoders return null for exact 0.0 but can provide the first frame for a tiny epsilon.
  return sink.getSample(1e-6).catch((e) => {
    const msg = String((e as any)?.message ?? e ?? '');
    const name = String((e as any)?.name ?? '');
    if (name === 'InputDisposedError' || msg.includes('Input has been disposed')) {
      return null;
    }
    throw e;
  });
}

export interface CompositorClip {
  itemId: string;
  trackId?: string;
  layer: number;
  sourcePath?: string;
  fileHandle?: FileSystemFileHandle;
  input?: Input;
  sink?: VideoSampleSink;
  firstTimestampS?: number;
  startUs: number;
  endUs: number;
  durationUs: number;
  sourceStartUs: number;
  /** Duration of the used source range (trimmed), i.e. sourceRange.durationUs */
  sourceRangeDurationUs: number;
  /** Full duration of the source media file, used to compute available handle material */
  sourceDurationUs: number;
  speed?: number;
  freezeFrameSourceUs?: number;
  sprite: Sprite;
  clipKind: 'video' | 'image' | 'solid' | 'adjustment' | 'text' | 'shape' | 'hud';
  sourceKind: 'videoFrame' | 'canvas' | 'bitmap';
  imageSource: ImageSource;
  lastVideoFrame: VideoFrame | null;
  canvas: OffscreenCanvas | null;
  ctx: OffscreenCanvasRenderingContext2D | null;
  bitmap: ImageBitmap | null;
  backgroundColor?: string;
  text?: string;
  style?: TextClipStyle;
  shapeType?: import('~/timeline/types').ShapeType;
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  hudType?: import('~/timeline/types').HudType;
  background?: import('~/timeline/types').HudMediaParams;
  content?: import('~/timeline/types').HudMediaParams;
  opacity?: number;
  blendMode?: TimelineBlendMode;
  effects?: ClipEffect[];
  transform?: ClipTransform;
  effectFilters?: Map<string, Filter>;
  transitionIn?: ClipTransition;
  transitionOut?: ClipTransition;
  transitionFilter?: Filter | null;
  transitionFilterType?: string | null;
  transitionSprite?: Sprite | null;
  transitionFromTexture?: RenderTexture | null;
  transitionToTexture?: RenderTexture | null;
  transitionOutputTexture?: RenderTexture | null;
  transitionCombinedTexture?: RenderTexture | null;
  textDirty?: boolean;
}

export interface CompositorTrack {
  id: string;
  layer: number;
  opacity?: number;
  blendMode?: TimelineBlendMode;
  effects?: ClipEffect[];
  container: Container;
  effectFilters?: Map<string, Filter>;
}

export class VideoCompositor {
  public app: Application | null = null;
  public canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  public clips: CompositorClip[] = [];
  public maxDurationUs = 0;

  private width = 1920;
  private height = 1080;
  private clipById = new Map<string, CompositorClip>();
  private trackById = new Map<string, CompositorTrack>();
  private trackByLayer = new Map<number, CompositorTrack>();
  private tracks: CompositorTrack[] = [];
  private replacedClipIds = new Set<string>();
  private lastRenderedTimeUs = 0;
  private clipPreferBitmapFallback = new Map<string, boolean>();
  private clipPreferCanvasFallback = new Map<string, boolean>();
  private stageSortDirty = true;
  private activeSortDirty = true;
  private contextLost = false;
  private adjustmentTexture: RenderTexture | null = null;
  private stageVisibilityState: boolean[] = [];
  private masterEffects: ClipEffect[] | null = null;
  private masterEffectFilters: Map<string, Filter> | null = null;
  private transitionFilters = new Map<string, Filter>();
  private filterQuadSprite: Sprite | null = null;
  private transitionCombineSprite: Sprite | null = null;
  private sampleRequestsInFlight = 0;
  private previewEffectsEnabled = true;
  private readonly sampleRequestQueue: Array<() => void> = [];
  private readonly activeTracker = new TimelineActiveTracker<CompositorClip>({
    getId: (clip) => clip.itemId,
    getStartUs: (clip) => clip.startUs,
    getEndUs: (clip) => clip.endUs,
  });

  private normalizeTrackOpacity(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    return Math.max(0, Math.min(1, value));
  }

  private buildTrackRuntimeList(timelineItems: any[]): Array<{
    id: string;
    layer: number;
    opacity?: number;
    blendMode?: TimelineBlendMode;
    effects?: ClipEffect[];
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
        effects: Array.isArray(track.effects) ? (track.effects as ClipEffect[]) : undefined,
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

  private async withVideoSampleSlot<T>(task: () => Promise<T>): Promise<T> {
    const max = Math.max(1, Math.round(VIDEO_CORE_LIMITS.MAX_CONCURRENT_VIDEO_SAMPLE_REQUESTS));
    if (this.sampleRequestsInFlight >= max) {
      await new Promise<void>((resolve) => this.sampleRequestQueue.push(resolve));
    }
    this.sampleRequestsInFlight += 1;
    try {
      return await task();
    } finally {
      this.sampleRequestsInFlight = Math.max(0, this.sampleRequestsInFlight - 1);
      const next = this.sampleRequestQueue.shift();
      if (next) next();
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
      preference: 'webgl',
      clearBeforeRender: true,
    });

    // Stop the automatic ticker, we will render manually
    this.app.ticker.stop();

    this.adjustmentTexture = RenderTexture.create({
      width: this.width,
      height: this.height,
    });
  }

  private onContextLost = (event: Event) => {
    event.preventDefault();
    console.warn('[VideoCompositor] WebGL context lost!');
    this.contextLost = true;
  };

  private onContextRestored = () => {
    console.warn('[VideoCompositor] WebGL context restored!');
    this.contextLost = false;
    this.stageSortDirty = true;
  };

  async loadTimeline(
    timelineClips: any[],
    deps: {
      getFileHandleByPath: (path: string) => Promise<FileSystemFileHandle | null>;
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
    const nextMaster =
      meta && Array.isArray((meta as any).masterEffects) ? (meta as any).masterEffects : null;
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
        typeof speedRaw === 'number' && Number.isFinite(speedRaw)
          ? Math.max(0.1, Math.min(10, speedRaw))
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
        reusable.effects = clipData.effects;
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

        const backgroundColor = String((clipData as any).backgroundColor ?? '#000000');
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
          effects: clipData.effects,
          transform: (clipData as any).transform,
        };

        (compositorClip as any).clipType = 'background';

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

        const clipCanvas = new OffscreenCanvas(Math.max(1, this.width), Math.max(1, this.height));
        const clipCtx = clipCanvas.getContext('2d');
        if (!clipCtx) {
          sequentialTimeUs = Math.max(sequentialTimeUs, endUs);
          continue;
        }

        const imageSource = new ImageSource({ resource: new OffscreenCanvas(2, 2) as any });
        const texture = new Texture({ source: imageSource });
        const sprite = new Sprite(texture);
        sprite.width = this.width;
        sprite.height = this.height;
        sprite.visible = false;
        (sprite as any).__clipId = itemId;

        const canvasSource = new CanvasSource({ resource: clipCanvas as any });
        sprite.texture.source = canvasSource as any;

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
          imageSource,
          lastVideoFrame: null,
          canvas: clipCanvas,
          ctx: clipCtx,
          bitmap: null,
          text: String((clipData as any).text ?? ''),
          style: (clipData as any).style,
          opacity: clipData.opacity,
          blendMode: resolveBlendMode((clipData as any).blendMode),
          effects: clipData.effects,
          transform: (clipData as any).transform,
          transitionIn: clipData.transitionIn,
          transitionOut: clipData.transitionOut,
          transitionFilter: null,
          transitionFilterType: null,
          textDirty: true,
        };

        (compositorClip as any).clipType = 'text';

        const trackRuntime = this.getTrackRuntimeForClip(compositorClip);
        if (trackRuntime) {
          trackRuntime.container.addChild(sprite);
        } else {
          this.app.stage.addChild(sprite);
        }

        this.drawTextClip(compositorClip);
        this.applySolidLayout(compositorClip);

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

        const clipCanvas = new OffscreenCanvas(Math.max(1, this.width), Math.max(1, this.height));
        const clipCtx = clipCanvas.getContext('2d');
        if (!clipCtx) {
          sequentialTimeUs = Math.max(sequentialTimeUs, endUs);
          continue;
        }

        const imageSource = new ImageSource({ resource: new OffscreenCanvas(2, 2) as any });
        const texture = new Texture({ source: imageSource });
        const sprite = new Sprite(texture);
        sprite.width = this.width;
        sprite.height = this.height;
        sprite.visible = false;
        (sprite as any).__clipId = itemId;

        const canvasSource = new CanvasSource({ resource: clipCanvas as any });
        sprite.texture.source = canvasSource as any;

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
          sourceKind: 'canvas',
          imageSource,
          lastVideoFrame: null,
          canvas: clipCanvas,
          ctx: clipCtx,
          bitmap: null,
          shapeType: (clipData as any).shapeType ?? 'square',
          fillColor: String((clipData as any).fillColor ?? '#ffffff'),
          strokeColor: String((clipData as any).strokeColor ?? '#000000'),
          strokeWidth: Number((clipData as any).strokeWidth ?? 0),
          opacity: clipData.opacity,
          blendMode: resolveBlendMode((clipData as any).blendMode),
          effects: clipData.effects,
          transform: (clipData as any).transform,
          transitionIn: clipData.transitionIn,
          transitionOut: clipData.transitionOut,
          transitionFilter: null,
          transitionFilterType: null,
          textDirty: true, // Reuse textDirty for shape updates for now
        };

        (compositorClip as any).clipType = 'shape';

        const trackRuntime = this.getTrackRuntimeForClip(compositorClip);
        if (trackRuntime) {
          trackRuntime.container.addChild(sprite);
        } else {
          this.app.stage.addChild(sprite);
        }

        this.drawShapeClip(compositorClip);
        this.applySolidLayout(compositorClip);

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
          effects: clipData.effects,
          transform: (clipData as any).transform,
        };

        (compositorClip as any).clipType = 'adjustment';

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

      const file = await fileHandle.getFile();

      const isImage =
        (typeof file?.type === 'string' && file.type.startsWith('image/')) ||
        getMediaTypeFromFilename(sourcePath || '') === 'image';
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
          effects: clipData.effects,
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
          effects: clipData.effects,
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
    const nextMaster =
      meta && Array.isArray((meta as any).masterEffects) ? (meta as any).masterEffects : null;
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
        typeof speedRaw === 'number' && Number.isFinite(speedRaw)
          ? Math.max(0.1, Math.min(10, speedRaw))
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
      clip.effects = next.effects;
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
      const trackRuntime = this.getTrackRuntimeForClip(clip);
      if (trackRuntime && clip.sprite.parent !== trackRuntime.container) {
        trackRuntime.container.addChild(clip.sprite);
      }
      if (clip.clipKind === 'solid') {
        clip.backgroundColor = String(
          (next as any).backgroundColor ?? clip.backgroundColor ?? '#000000',
        );
        clip.sprite.tint = parseHexColor(clip.backgroundColor);
      }
      if (!clip.effectFilters) {
        clip.effectFilters = new Map();
      }
    }

    this.clips.sort((a, b) => a.startUs - b.startUs || a.layer - b.layer);
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

        if (clip.clipKind === 'text') {
          if (clip.textDirty) {
            this.drawTextClip(clip);
            clip.textDirty = false;
          }
          clip.sprite.visible = true;
          continue;
        }

        const localTimeUs = timeUs - clip.startUs;
        const speed = typeof clip.speed === 'number' ? clip.speed : 1;
        const maxTimelineUs = speed > 0 ? Math.round(clip.sourceDurationUs / speed) : 0;
        if (localTimeUs < 0 || localTimeUs >= maxTimelineUs) {
          console.warn('[DBG] clip hidden by maxTimelineUs', {
            id: clip.itemId,
            localTimeUs,
            maxTimelineUs,
            sourceDurationUs: clip.sourceDurationUs,
            sourceRangeDurationUs: clip.sourceRangeDurationUs,
            durationUs: clip.durationUs,
          });
          clip.sprite.visible = false;
          continue;
        }

        const freezeUs = clip.freezeFrameSourceUs;
        const sampleTimeS =
          typeof freezeUs === 'number'
            ? Math.max(0, freezeUs) / 1_000_000
            : (clip.sourceStartUs + Math.round(localTimeUs * speed)) / 1_000_000;

        if (clip.transitionIn) {
          console.warn('[DBG-IN]', {
            id: clip.itemId,
            localTimeUs,
            sampleTimeS,
            freezeUs,
            sourceStartUs: clip.sourceStartUs,
            sourceRangeDurationUs: clip.sourceRangeDurationUs,
            sourceDurationUs: clip.sourceDurationUs,
            durationUs: clip.durationUs,
            maxTimelineUs,
          });
        }

        if (!clip.sink) {
          clip.sprite.visible = false;
          continue;
        }

        const request = this.withVideoSampleSlot(() =>
          getVideoSampleWithZeroFallback(clip.sink as any, sampleTimeS, clip.firstTimestampS),
        )
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
        if (!tr || mode !== 'transition' || tr.durationUs <= 0) continue;
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
        if (prevClip.clipKind === 'image' || prevClip.clipKind === 'solid') {
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
          const lastUs = Math.max(
            0,
            prevClip.sourceStartUs + prevClip.sourceRangeDurationUs - 1_000,
          );
          const shadowSampleTimeS = Math.max(0, lastUs / 1_000_000);
          const req = this.withVideoSampleSlot(() =>
            getVideoSampleWithZeroFallback(
              prevClip.sink as any,
              shadowSampleTimeS,
              prevClip.firstTimestampS,
            ),
          )
            .then((sample) => ({ clip: prevClip, sample }))
            .catch(() => ({ clip: prevClip, sample: null }));
          blendShadowRequests.push(req);
          continue;
        }

        // Seek into handle material: frames past the source range end point
        const overrunUs = localTimeUs;
        const sourceRangeEndUs = prevClip.sourceStartUs + prevClip.sourceRangeDurationUs;
        const handleSampleUs = sourceRangeEndUs + overrunUs;
        // Clamp to available handle
        const clampedUs = Math.min(
          handleSampleUs,
          prevClip.sourceStartUs + prevClip.sourceDurationUs - 1_000,
        );
        const shadowSampleTimeS = Math.max(0, clampedUs / 1_000_000);
        const req = this.withVideoSampleSlot(() =>
          getVideoSampleWithZeroFallback(
            prevClip.sink as any,
            shadowSampleTimeS,
            prevClip.firstTimestampS,
          ),
        )
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
        if (!tr || tr.mode !== 'fade' || tr.durationUs <= 0) continue;
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

      await this.applyShaderTransitions(active, timeUs);

      if (!this.app || !this.canvas || !this.app.renderer) {
        return null;
      }

      this.lastRenderedTimeUs = timeUs;

      if (
        this.adjustmentTexture &&
        active.some((c) => c.clipKind === 'adjustment' && c.sprite.visible)
      ) {
        const textureOk =
          !(this.adjustmentTexture as any)?.destroyed &&
          typeof (this.adjustmentTexture as any)?.uid === 'number';
        if (!textureOk) {
          try {
            safeDispose(this.adjustmentTexture);
          } catch {
            // ignore
          }
          this.adjustmentTexture = RenderTexture.create({
            width: this.width,
            height: this.height,
          });
        }

        const children = this.app.stage.children;
        if (this.stageVisibilityState.length !== children.length) {
          this.stageVisibilityState = new Array(children.length);
        }
        for (let i = 0; i < children.length; i++) {
          this.stageVisibilityState[i] = children[i]?.visible ?? false;
        }

        const visibleAdjustmentByParent = new Map<Container, CompositorClip>();
        for (const clip of active) {
          if (clip.clipKind !== 'adjustment' || !clip.sprite.visible) continue;
          const parent = clip.sprite.parent;
          if (!parent || !(parent instanceof Container)) continue;
          visibleAdjustmentByParent.set(parent, clip);
        }

        let applied = false;
        for (let i = 0; i < children.length; i++) {
          const child = children[i] as Container | undefined;
          if (!child) continue;

          const adjustmentClip = visibleAdjustmentByParent.get(child);
          if (!adjustmentClip) continue;

          // Hide adjustment layer itself and everything above it
          for (let j = i; j < children.length; j++) {
            const childObj = children[j];
            if (childObj) childObj.visible = false;
          }

          if (this.adjustmentTexture && this.app.renderer) {
            this.app.renderer.render({
              container: this.app.stage,
              target: this.adjustmentTexture,
              clear: true,
            });
          }

          // Restore visibility
          for (let j = 0; j < children.length; j++) {
            const childObj = children[j];
            if (childObj) childObj.visible = this.stageVisibilityState[j] as boolean;
          }

          if (this.adjustmentTexture) {
            adjustmentClip.sprite.texture = this.adjustmentTexture;
          }

          applied = true;
          break;
        }

        if (!applied) {
          for (const c of this.clips) {
            if (c.clipKind !== 'adjustment') continue;
            if (c.sprite.texture === this.adjustmentTexture) {
              c.sprite.texture = Texture.EMPTY;
            }
          }
        }
      }

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
   *  Returns null if there is a gap larger than 200ms between the clips. */
  private findPrevClipOnLayer(clip: CompositorClip): CompositorClip | null {
    let best: CompositorClip | null = null;
    for (const c of this.clips) {
      if (c.layer !== clip.layer) continue;
      if (c.itemId === clip.itemId) continue;
      if (c.startUs > clip.startUs + 1_000) continue;
      if (!best || c.endUs > best.endUs) best = c;
    }
    if (!best) return null;
    // Reject only for a large gap — allow small gaps to still show a reasonable blend shadow.
    if (clip.startUs - best.endUs > 1_000_000) return null;
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

  private renderSingleClipToTexture(clip: CompositorClip, texture: RenderTexture) {
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
    clip.sprite.visible = true;

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
    if (clip.clipKind === 'image' || clip.clipKind === 'solid' || clip.clipKind === 'text') {
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
    const sampleUs =
      handleUs < 1_000
        ? Math.max(0, clip.sourceStartUs + clip.sourceRangeDurationUs - 1_000)
        : Math.min(
            sourceRangeEndUs + transitionOffsetUs,
            clip.sourceStartUs + clip.sourceDurationUs - 1_000,
          );

    const sample = await this.withVideoSampleSlot(() =>
      getVideoSampleWithZeroFallback(
        clip.sink as any,
        Math.max(0, sampleUs / 1_000_000),
        clip.firstTimestampS,
      ),
    ).catch(() => null);

    if (!sample) {
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
      if (mode !== 'transition' && mode !== 'fade') {
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
      this.renderSingleClipToTexture(clip, clip.transitionToTexture);

      const fromTexture = clip.transitionFromTexture;
      let prevClip: CompositorClip | null = null;

      if (mode === 'fade') {
        this.renderLowerLayersToTexture(clip.layer, fromTexture);
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

    return candidate.resources != null;
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

  private applyClipLayoutForCurrentSource(clip: CompositorClip) {
    if (clip.clipKind === 'solid' || clip.clipKind === 'text' || clip.clipKind === 'adjustment') {
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
    if (!clip.effectFilters) {
      clip.effectFilters = new Map();
    }

    if (!this.previewEffectsEnabled) {
      clip.sprite.filters = null;
      return;
    }

    const filters: Filter[] = [];
    const seenIds = new Set<string>();

    if (Array.isArray(clip.effects) && clip.effects.length > 0) {
      for (const effect of clip.effects) {
        if (!effect?.enabled) continue;
        if (typeof effect.id !== 'string' || effect.id.length === 0) continue;
        if (typeof effect.type !== 'string' || effect.type.length === 0) continue;

        const manifest = getEffectManifest(effect.type);
        if (!manifest) continue;

        seenIds.add(effect.id);
        let filter = clip.effectFilters.get(effect.id);
        if (!filter) {
          filter = manifest.createFilter();
          clip.effectFilters.set(effect.id, filter);
        }

        try {
          manifest.updateFilter(filter, effect);
        } catch (err) {
          console.error('[VideoCompositor] Failed to update effect filter', err);
          continue;
        }

        filters.push(filter);
      }
    }

    // Cleanup filters for removed effects
    for (const [id, filter] of clip.effectFilters.entries()) {
      if (seenIds.has(id)) continue;
      clip.effectFilters.delete(id);
      try {
        (filter as any)?.destroy?.();
      } catch {
        // ignore
      }
    }

    clip.sprite.filters = filters.length > 0 ? filters : null;
  }

  private applyTrackEffects(track: CompositorTrack) {
    if (!track.effectFilters) {
      track.effectFilters = new Map();
    }

    if (!this.previewEffectsEnabled) {
      track.container.filters = null;
      return;
    }

    const filters: Filter[] = [];
    const seenIds = new Set<string>();

    if (Array.isArray(track.effects) && track.effects.length > 0) {
      for (const effect of track.effects) {
        if (!effect?.enabled) continue;
        if (typeof effect.id !== 'string' || effect.id.length === 0) continue;
        if (typeof effect.type !== 'string' || effect.type.length === 0) continue;

        const manifest = getEffectManifest(effect.type);
        if (!manifest) continue;

        seenIds.add(effect.id);
        let filter = track.effectFilters.get(effect.id);
        if (!filter) {
          filter = manifest.createFilter();
          track.effectFilters.set(effect.id, filter);
        }

        try {
          manifest.updateFilter(filter, effect);
        } catch (err) {
          console.error('[VideoCompositor] Failed to update track effect filter', err);
          continue;
        }

        filters.push(filter);
      }
    }

    for (const [id, filter] of track.effectFilters.entries()) {
      if (seenIds.has(id)) continue;
      track.effectFilters.delete(id);
      try {
        (filter as any)?.destroy?.();
      } catch {
        // ignore
      }
    }

    track.container.filters = filters.length > 0 ? filters : null;
  }

  private applyMasterEffects() {
    if (!this.app) return;

    if (!this.masterEffectFilters) {
      this.masterEffectFilters = new Map();
    }

    if (!this.previewEffectsEnabled) {
      this.app.stage.filters = null;
      return;
    }

    const filters: Filter[] = [];
    const seenIds = new Set<string>();
    const effects = Array.isArray(this.masterEffects) ? this.masterEffects : [];

    for (const effect of effects) {
      if (!effect?.enabled) continue;
      if (typeof effect.id !== 'string' || effect.id.length === 0) continue;
      if (typeof effect.type !== 'string' || effect.type.length === 0) continue;

      const manifest = getEffectManifest(effect.type);
      if (!manifest) continue;

      seenIds.add(effect.id);
      let filter = this.masterEffectFilters.get(effect.id);
      if (!filter) {
        filter = manifest.createFilter();
        this.masterEffectFilters.set(effect.id, filter);
      }

      try {
        manifest.updateFilter(filter, effect);
      } catch (err) {
        console.error('[VideoCompositor] Failed to update master effect filter', err);
        continue;
      }

      filters.push(filter);
    }

    for (const [id, filter] of this.masterEffectFilters.entries()) {
      if (seenIds.has(id)) continue;
      this.masterEffectFilters.delete(id);
      try {
        (filter as any)?.destroy?.();
      } catch {
        // ignore
      }
    }

    this.app.stage.filters = filters.length > 0 ? filters : null;
  }

  private async updateClipTextureFromSample(sample: any, clip: CompositorClip) {
    const preferCanvas = this.clipPreferCanvasFallback.get(clip.itemId) === true;

    try {
      if (preferCanvas) {
        throw new Error('Prefer canvas fallback');
      }

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
      this.clipPreferCanvasFallback.set(clip.itemId, true);
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

  private drawShapeClip(clip: CompositorClip) {
    if (clip.clipKind !== 'shape') return;
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

    const type = clip.shapeType ?? 'square';
    const fill = clip.fillColor ?? '#ffffff';
    const stroke = clip.strokeColor ?? '#000000';
    const strokeWidth = clip.strokeWidth ?? 0;

    ctx.save();
    ctx.fillStyle = fill;
    if (strokeWidth > 0) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = strokeWidth;
    }

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    // We draw shapes large enough to be scaled down safely.
    // They will be positioned and scaled by applySpriteLayout.
    const size = Math.min(canvas.width, canvas.height) * 0.8;

    ctx.beginPath();
    if (type === 'square') {
      const half = size / 2;
      ctx.rect(cx - half, cy - half, size, size);
    } else if (type === 'circle') {
      ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
    } else if (type === 'triangle') {
      const half = size / 2;
      const h = (Math.sqrt(3) / 2) * size;
      ctx.moveTo(cx, cy - h / 2);
      ctx.lineTo(cx + half, cy + h / 2);
      ctx.lineTo(cx - half, cy + h / 2);
      ctx.closePath();
    } else if (type === 'star') {
      const spikes = 5;
      const outerRadius = size / 2;
      const innerRadius = outerRadius / 2;
      let rot = (Math.PI / 2) * 3;
      const step = Math.PI / spikes;
      ctx.moveTo(cx, cy - outerRadius);
      for (let i = 0; i < spikes; i++) {
        let x = cx + Math.cos(rot) * outerRadius;
        let y = cy + Math.sin(rot) * outerRadius;
        ctx.lineTo(x, y);
        rot += step;
        x = cx + Math.cos(rot) * innerRadius;
        y = cy + Math.sin(rot) * innerRadius;
        ctx.lineTo(x, y);
        rot += step;
      }
      ctx.lineTo(cx, cy - outerRadius);
      ctx.closePath();
    } else if (type === 'cloud') {
      // Simple cloud approximation
      const r = size * 0.15;
      ctx.arc(cx - r * 1.5, cy, r, 0, Math.PI * 2);
      ctx.arc(cx + r * 1.5, cy, r, 0, Math.PI * 2);
      ctx.arc(cx, cy - r, r * 1.2, 0, Math.PI * 2);
      ctx.arc(cx - r * 0.8, cy + r * 0.5, r, 0, Math.PI * 2);
      ctx.arc(cx + r * 0.8, cy + r * 0.5, r, 0, Math.PI * 2);
    } else if (type === 'speech_bubble') {
      const w = size;
      const h = size * 0.7;
      const r = size * 0.1;
      const px = cx - w / 2;
      const py = cy - h / 2;

      ctx.moveTo(px + r, py);
      ctx.lineTo(px + w - r, py);
      ctx.quadraticCurveTo(px + w, py, px + w, py + r);
      ctx.lineTo(px + w, py + h - r);
      ctx.quadraticCurveTo(px + w, py + h, px + w - r, py + h);

      // The pointer
      ctx.lineTo(px + w * 0.3 + r, py + h);
      ctx.lineTo(px + w * 0.2, py + h + size * 0.15);
      ctx.lineTo(px + w * 0.2 + r, py + h);

      ctx.lineTo(px + r, py + h);
      ctx.quadraticCurveTo(px, py + h, px, py + h - r);
      ctx.lineTo(px, py + r);
      ctx.quadraticCurveTo(px, py, px + r, py);
      ctx.closePath();
    } else {
      // Default fallback
      const half = size / 2;
      ctx.rect(cx - half, cy - half, size, size);
    }

    ctx.fill();
    if (strokeWidth > 0) {
      ctx.stroke();
    }
    ctx.restore();

    clip.sprite.texture.source.update();
  }

  private drawTextClip(clip: CompositorClip) {
    if (clip.clipKind !== 'text') return;
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

    const layout = computeTextLayoutMetrics({
      text: String(clip.text ?? ''),
      style: clip.style,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      measureText: (text, font) => {
        ctx.font = font;
        return ctx.measureText(text).width;
      },
    });

    if (layout.style.backgroundColor.length > 0) {
      ctx.save();
      ctx.fillStyle = layout.style.backgroundColor;
      ctx.fillRect(
        layout.backgroundX,
        layout.backgroundY,
        layout.backgroundWidth,
        layout.backgroundHeight,
      );
      ctx.restore();
    }

    ctx.fillStyle = layout.style.color;
    ctx.textAlign = layout.style.align;
    ctx.textBaseline = 'top';
    ctx.font = `${layout.style.fontWeight} ${layout.fontSizePx}px ${layout.style.fontFamily}`;

    const drawWithLetterSpacing = (text: string, x: number, y: number) => {
      if (!Number.isFinite(layout.letterSpacingPx) || layout.letterSpacingPx === 0) {
        ctx.fillText(text, x, y);
        return;
      }

      ctx.save();
      ctx.textAlign = 'left';

      if (layout.style.align === 'center' || layout.style.align === 'right') {
        const baseWidth = ctx.measureText(text).width;
        const extra = Math.max(0, text.length - 1) * layout.letterSpacingPx;
        const total = baseWidth + extra;
        const leftX = layout.style.align === 'center' ? x - total / 2 : x - total;

        let dx = leftX;
        for (let i = 0; i < text.length; i++) {
          const ch = text[i] ?? '';
          ctx.fillText(ch, dx, y);
          dx += ctx.measureText(ch).width + layout.letterSpacingPx;
        }
        ctx.restore();
        return;
      }

      let dx = x;
      for (let i = 0; i < text.length; i++) {
        const ch = text[i] ?? '';
        ctx.fillText(ch, dx, y);
        dx += ctx.measureText(ch).width + layout.letterSpacingPx;
      }
      ctx.restore();
    };

    for (let i = 0; i < layout.lines.length; i++) {
      const line = layout.lines[i] ?? '';
      const y = layout.textBlockTopPx + i * layout.lineHeightPx + layout.yOffsetPx;
      drawWithLetterSpacing(line, layout.textStartX, y);
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
    this.trackById.clear();
    this.trackByLayer.clear();
    this.replacedClipIds.clear();
    this.lastRenderedTimeUs = 0;
    this.activeTracker.reset();
    this.stageSortDirty = true;
    this.activeSortDirty = true;
    this.maxDurationUs = 0;
    this.stageVisibilityState = [];
  }

  destroy() {
    this.clearClips();
    if (this.adjustmentTexture) {
      safeDispose(this.adjustmentTexture);
      this.adjustmentTexture = null;
    }
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

function parseHexColor(value: string): number {
  const raw = String(value ?? '').trim();
  const hex = raw.startsWith('#') ? raw.slice(1) : raw;
  if (hex.length === 3) {
    const r = hex[0] ?? '0';
    const g = hex[1] ?? '0';
    const b = hex[2] ?? '0';
    const expanded = `${r}${r}${g}${g}${b}${b}`;
    const parsed = Number.parseInt(expanded, 16);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const parsed = Number.parseInt(hex.padStart(6, '0').slice(0, 6), 16);
  return Number.isFinite(parsed) ? parsed : 0;
}
