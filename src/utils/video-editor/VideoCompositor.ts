import { safeDispose } from './utils';
import { TimelineActiveTracker } from './TimelineActiveTracker';
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
import { getTransitionManifest, easeInOutCubic } from '../../transitions';
import type { TextClipStyle } from '~/timeline/types';
import { VIDEO_CORE_LIMITS } from '../constants';

export async function getVideoSampleWithZeroFallback(
  sink: Pick<VideoSampleSink, 'getSample'>,
  timeS: number,
  firstTimestampS?: number,
): Promise<any | null> {
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
  sourceDurationUs: number;
  speed?: number;
  freezeFrameSourceUs?: number;
  sprite: Sprite;
  clipKind: 'video' | 'image' | 'solid' | 'adjustment' | 'text';
  sourceKind: 'videoFrame' | 'canvas' | 'bitmap';
  imageSource: ImageSource;
  lastVideoFrame: VideoFrame | null;
  canvas: OffscreenCanvas | null;
  ctx: OffscreenCanvasRenderingContext2D | null;
  bitmap: ImageBitmap | null;
  backgroundColor?: string;
  text?: string;
  style?: TextClipStyle;
  opacity?: number;
  effects?: any[];
  transform?: {
    scale?: { x: number; y: number; linked?: boolean };
    rotationDeg?: number;
    position?: { x: number; y: number };
    anchor?: { preset: string; x?: number; y?: number };
  };
  effectFilters?: Map<string, Filter>;
  transitionIn?: {
    type: string;
    durationUs: number;
    mode?: 'blend' | 'composite';
    curve?: 'linear' | 'bezier';
  };
  transitionOut?: {
    type: string;
    durationUs: number;
    mode?: 'blend' | 'composite';
    curve?: 'linear' | 'bezier';
  };
}

export class VideoCompositor {
  public app: Application | null = null;
  public canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  public clips: CompositorClip[] = [];
  public maxDurationUs = 0;

  private width = 1920;
  private height = 1080;
  private clipById = new Map<string, CompositorClip>();
  private replacedClipIds = new Set<string>();
  private lastRenderedTimeUs = 0;
  private clipPreferBitmapFallback = new Map<string, boolean>();
  private clipPreferCanvasFallback = new Map<string, boolean>();
  private stageSortDirty = true;
  private activeSortDirty = true;
  private contextLost = false;
  private adjustmentTexture: RenderTexture | null = null;
  private stageVisibilityState: boolean[] = [];
  private sampleRequestsInFlight = 0;
  private readonly sampleRequestQueue: Array<() => void> = [];
  private readonly activeTracker = new TimelineActiveTracker<CompositorClip>({
    getId: (clip) => clip.itemId,
    getStartUs: (clip) => clip.startUs,
    getEndUs: (clip) => clip.endUs,
  });

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
    getFileHandleByPath: (path: string) => Promise<FileSystemFileHandle | null>,
    checkCancel?: () => boolean,
  ): Promise<number> {
    if (!this.app) throw new Error('VideoCompositor not initialized');

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
        clipTypeRaw === 'text'
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
      const requestedTimelineDurationUs = Math.max(
        0,
        Math.round(Number(clipData.timelineRange?.durationUs ?? 0)),
      );
      const requestedSourceDurationUs = Math.max(
        0,
        Math.round(Number(clipData.sourceRange?.durationUs ?? requestedTimelineDurationUs)),
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
        reusable.sourceDurationUs = safeSourceDurationUs;
        reusable.speed = speed;
        reusable.freezeFrameSourceUs = freezeFrameSourceUs;
        reusable.layer = layer;
        reusable.opacity = clipData.opacity;
        reusable.effects = clipData.effects;
        reusable.transform = (clipData as any).transform;
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
        this.app.stage.addChild(sprite);

        const backgroundColor = String((clipData as any).backgroundColor ?? '#000000');
        sprite.tint = parseHexColor(backgroundColor);

        const compositorClip: CompositorClip = {
          itemId,
          layer,
          startUs,
          endUs,
          durationUs: Math.max(0, requestedTimelineDurationUs),
          sourceStartUs: 0,
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
          effects: clipData.effects,
          transform: (clipData as any).transform,
        };

        (compositorClip as any).clipType = 'background';

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
        this.app.stage.addChild(sprite);

        const canvasSource = new CanvasSource({ resource: clipCanvas as any });
        sprite.texture.source = canvasSource as any;

        const compositorClip: CompositorClip = {
          itemId,
          layer,
          startUs,
          endUs,
          durationUs: Math.max(0, requestedTimelineDurationUs),
          sourceStartUs: 0,
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
          effects: clipData.effects,
          transform: (clipData as any).transform,
          transitionIn: clipData.transitionIn,
          transitionOut: clipData.transitionOut,
        };

        (compositorClip as any).clipType = 'text';

        this.drawTextClip(compositorClip);
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
        this.app.stage.addChild(sprite);

        const compositorClip: CompositorClip = {
          itemId,
          layer,
          startUs,
          endUs,
          durationUs: Math.max(0, requestedTimelineDurationUs),
          sourceStartUs: 0,
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
          effects: clipData.effects,
          transform: (clipData as any).transform,
        };

        (compositorClip as any).clipType = 'adjustment';

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

      const fileHandle = await getFileHandleByPath(sourcePath);
      if (!fileHandle) {
        sequentialTimeUs = Math.max(sequentialTimeUs, endUsFallback);
        continue;
      }

      const file = await fileHandle.getFile();

      if (typeof file?.type === 'string' && file.type.startsWith('image/')) {
        const endUs = startUs + Math.max(0, requestedTimelineDurationUs);
        sequentialTimeUs = Math.max(sequentialTimeUs, endUs);

        const imageSource = new ImageSource({ resource: new OffscreenCanvas(2, 2) as any });
        const texture = new Texture({ source: imageSource });
        const sprite = new Sprite(texture);
        sprite.width = 1;
        sprite.height = 1;
        sprite.visible = false;
        (sprite as any).__clipId = itemId;
        this.app.stage.addChild(sprite);

        let bmp: ImageBitmap | null = null;
        try {
          bmp = await createImageBitmap(file);
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
          layer,
          sourcePath,
          fileHandle,
          startUs,
          endUs,
          durationUs: Math.max(0, requestedTimelineDurationUs),
          sourceStartUs: 0,
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
          effects: clipData.effects,
          transform: (clipData as any).transform,
          transitionIn: clipData.transitionIn,
          transitionOut: clipData.transitionOut,
        };

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
        this.app.stage.addChild(sprite);

        const compositorClip: CompositorClip = {
          itemId,
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
          effects: clipData.effects,
          transform: (clipData as any).transform,
          transitionIn: clipData.transitionIn,
          transitionOut: clipData.transitionOut,
        };

        nextClips.push(compositorClip);
        nextClipById.set(itemId, compositorClip);
      } catch (err) {
        console.error(`[VideoCompositor] Failed to load video clip ${itemId}:`, err);
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
      const sourceDurationUs = Math.max(
        0,
        Math.round(Number(next.sourceRange?.durationUs ?? clip.sourceDurationUs)),
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
      clip.sourceDurationUs = sourceDurationUs;
      clip.speed = speed;
      clip.freezeFrameSourceUs = freezeFrameSourceUs;
      clip.layer = layer;
      clip.opacity = next.opacity;
      clip.effects = next.effects;
      clip.transform = (next as any).transform;
      clip.transitionIn = (next as any).transitionIn;
      clip.transitionOut = (next as any).transitionOut;
      if (clip.clipKind === 'solid') {
        clip.backgroundColor = String(
          (next as any).backgroundColor ?? clip.backgroundColor ?? '#000000',
        );
        clip.sprite.tint = parseHexColor(clip.backgroundColor);
        this.applySolidLayout(clip);
      }
      if (!clip.effectFilters) {
        clip.effectFilters = new Map();
      }
    }

    this.clips.sort((a, b) => a.startUs - b.startUs || a.layer - b.layer);
    this.maxDurationUs = this.clips.length > 0 ? Math.max(0, ...this.clips.map((c) => c.endUs)) : 0;

    this.lastRenderedTimeUs = 0;
    this.activeTracker.reset();
    this.stageSortDirty = true;
    this.activeSortDirty = true;
    return this.maxDurationUs;
  }

  async renderFrame(timeUs: number): Promise<OffscreenCanvas | HTMLCanvasElement | null> {
    if (!this.app || !this.canvas) return null;

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
      const sampleRequests: Array<Promise<{ clip: CompositorClip; sample: any | null }>> = [];

      for (const clip of active) {
        const effectiveOpacity = this.computeTransitionOpacity(clip, timeUs);
        clip.sprite.alpha = effectiveOpacity;

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
          this.drawTextClip(clip);
          clip.sprite.visible = true;
          continue;
        }

        const localTimeUs = timeUs - clip.startUs;
        const speed = typeof clip.speed === 'number' ? clip.speed : 1;
        const maxTimelineUs = speed > 0 ? Math.round(clip.sourceDurationUs / speed) : 0;
        if (localTimeUs < 0 || localTimeUs >= maxTimelineUs) {
          clip.sprite.visible = false;
          continue;
        }

        const freezeUs = clip.freezeFrameSourceUs;
        const sampleTimeS =
          typeof freezeUs === 'number'
            ? Math.max(0, freezeUs) / 1_000_000
            : (clip.sourceStartUs + Math.round(localTimeUs * speed)) / 1_000_000;
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
        if (!tr || (tr.mode ?? 'blend') !== 'blend' || tr.durationUs <= 0) continue;
        const localTimeUs = timeUs - clip.startUs;
        if (localTimeUs >= tr.durationUs) continue;

        const prevClip = this.findPrevClipOnLayer(clip);
        if (!prevClip || active.includes(prevClip)) continue;

        const manifest = getTransitionManifest(tr.type);
        const rawProgress = Math.max(0, Math.min(1, localTimeUs / tr.durationUs));
        const shadowAlpha = manifest
          ? manifest.computeOutOpacity(rawProgress, {}, tr.curve ?? 'linear')
          : 1 - rawProgress;

        prevClip.sprite.alpha = Math.max(0, Math.min(1, shadowAlpha));

        // Images and solid clips: keep visible indefinitely
        if (prevClip.clipKind === 'image' || prevClip.clipKind === 'solid') {
          prevClip.sprite.visible = true;
          continue;
        }

        // Check if source media has frames beyond the clip's out-point (handle material)
        // handleUs = total available source after clip end
        const handleUs = prevClip.sourceDurationUs - prevClip.durationUs;
        if (!prevClip.sink) {
          prevClip.sprite.visible = false;
          continue;
        }

        if (handleUs < 1_000) {
          // No extra source material: freeze the last available frame of the previous clip.
          const lastUs = Math.max(0, prevClip.sourceStartUs + prevClip.sourceDurationUs - 1_000);
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

        // Seek into handle material: frames at sourceStartUs + durationUs + overrun
        const overrunUs = localTimeUs;
        const handleSampleUs = prevClip.sourceStartUs + prevClip.durationUs + overrunUs;
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
        if (!tr || (tr.mode ?? 'blend') !== 'composite' || tr.durationUs <= 0) continue;
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

      if (this.stageSortDirty) {
        // Ensure stage ordering matches layer ordering for correct blending
        this.app.stage.children.sort((a: any, b: any) => {
          const aClip = this.clipById.get((a as any).__clipId ?? '') as any;
          const bClip = this.clipById.get((b as any).__clipId ?? '') as any;
          const aLayer = typeof aClip?.layer === 'number' ? aClip.layer : 0;
          const bLayer = typeof bClip?.layer === 'number' ? bClip.layer : 0;
          return aLayer - bLayer;
        });
        this.stageSortDirty = false;
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

        let applied = false;
        for (let i = 0; i < children.length; i++) {
          const child = children[i];
          const clipId = (child as any)?.__clipId;
          if (!clipId) continue;
          const clip = this.clipById.get(clipId);
          if (!clip || clip.clipKind !== 'adjustment' || !clip.sprite.visible) continue;

          // Hide adjustment layer itself and everything above it
          for (let j = i; j < children.length; j++) {
            const childObj = children[j];
            if (childObj) childObj.visible = false;
          }

          if (this.adjustmentTexture) {
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
            clip.sprite.texture = this.adjustmentTexture;
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

      this.app.render();

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
      if (c.endUs > clip.startUs + 1_000) continue; // skip clips that end after current start
      if (!best || c.endUs > best.endUs) best = c;
    }
    if (!best) return null;
    // Reject only for a large gap — allow small gaps to still show a reasonable blend shadow.
    if (clip.startUs - best.endUs > 1_000_000) return null;
    return best;
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
    const tr = clip.transform;
    const scaleX = typeof tr?.scale?.x === 'number' && Number.isFinite(tr.scale.x) ? tr.scale.x : 1;
    const scaleY = typeof tr?.scale?.y === 'number' && Number.isFinite(tr.scale.y) ? tr.scale.y : 1;
    const rotationDeg =
      typeof tr?.rotationDeg === 'number' && Number.isFinite(tr.rotationDeg) ? tr.rotationDeg : 0;
    const posX =
      typeof tr?.position?.x === 'number' && Number.isFinite(tr.position.x) ? tr.position.x : 0;
    const posY =
      typeof tr?.position?.y === 'number' && Number.isFinite(tr.position.y) ? tr.position.y : 0;

    const anchor = tr?.anchor;
    const preset = typeof anchor?.preset === 'string' ? anchor.preset : 'center';
    const normalizedAnchor = (() => {
      switch (preset) {
        case 'topLeft':
          return { x: 0, y: 0 };
        case 'topRight':
          return { x: 1, y: 0 };
        case 'bottomLeft':
          return { x: 0, y: 1 };
        case 'bottomRight':
          return { x: 1, y: 1 };
        case 'custom': {
          const ax = typeof anchor?.x === 'number' && Number.isFinite(anchor.x) ? anchor.x : 0.5;
          const ay = typeof anchor?.y === 'number' && Number.isFinite(anchor.y) ? anchor.y : 0.5;
          return { x: Math.max(0, Math.min(1, ax)), y: Math.max(0, Math.min(1, ay)) };
        }
        case 'center':
        default:
          return { x: 0.5, y: 0.5 };
      }
    })();

    this.applyTransformLayout({
      clip,
      baseX: 0,
      baseY: 0,
      targetW: this.width,
      targetH: this.height,
      normalizedAnchor,
      scaleX,
      scaleY,
      rotationDeg,
      posX,
      posY,
    });
  }

  private computeTransitionOpacity(clip: CompositorClip, timeUs: number): number {
    const baseOpacity = clip.opacity ?? 1;
    const localTimeUs = timeUs - clip.startUs;
    let opacity = baseOpacity;

    if (clip.transitionIn && clip.transitionIn.durationUs > 0) {
      const dur = clip.transitionIn.durationUs;
      const curve = clip.transitionIn.curve ?? 'linear';
      // In composite mode the clip fades from the lower track composition — opacity still applies
      if (localTimeUs < dur) {
        const manifest = getTransitionManifest(clip.transitionIn.type);
        if (manifest) {
          const rawProgress = Math.max(0, Math.min(1, localTimeUs / dur));
          opacity = Math.min(
            opacity,
            baseOpacity * manifest.computeInOpacity(rawProgress, {}, curve),
          );
        }
      }
    }

    if (clip.transitionOut && clip.transitionOut.durationUs > 0) {
      const dur = clip.transitionOut.durationUs;
      const curve = clip.transitionOut.curve ?? 'linear';
      const clipDurUs = clip.durationUs;
      const outStartUs = clipDurUs - dur;
      if (localTimeUs >= outStartUs) {
        const manifest = getTransitionManifest(clip.transitionOut.type);
        if (manifest) {
          const rawProgress = Math.max(0, Math.min(1, (localTimeUs - outStartUs) / dur));
          opacity = Math.min(
            opacity,
            baseOpacity * manifest.computeOutOpacity(rawProgress, {}, curve),
          );
        }
      }
    }

    return Math.max(0, Math.min(1, opacity));
  }

  private applyClipEffects(clip: CompositorClip) {
    if (!clip.effectFilters) {
      clip.effectFilters = new Map();
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

    clip.sprite.filters = filters.length > 0 ? (filters as any) : null;
  }

  private async updateClipTextureFromSample(sample: any, clip: CompositorClip) {
    const preferCanvas = this.clipPreferCanvasFallback.get(clip.itemId) === true;

    try {
      if (preferCanvas) {
        throw new Error('Prefer canvas fallback');
      }

      // Prefer WebCodecs VideoFrame path (GPU-friendly upload).
      if (typeof sample?.toVideoFrame === 'function') {
        const frame = sample.toVideoFrame() as VideoFrame;
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

        clip.lastVideoFrame = frame;
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
    const viewportScale = Math.min(this.width / frameW, this.height / frameH);
    const targetW = frameW * viewportScale;
    const targetH = frameH * viewportScale;
    const baseX = (this.width - targetW) / 2;
    const baseY = (this.height - targetH) / 2;

    const tr = clip.transform;
    const scaleX = typeof tr?.scale?.x === 'number' && Number.isFinite(tr.scale.x) ? tr.scale.x : 1;
    const scaleY = typeof tr?.scale?.y === 'number' && Number.isFinite(tr.scale.y) ? tr.scale.y : 1;
    const rotationDeg =
      typeof tr?.rotationDeg === 'number' && Number.isFinite(tr.rotationDeg) ? tr.rotationDeg : 0;
    const posX =
      typeof tr?.position?.x === 'number' && Number.isFinite(tr.position.x) ? tr.position.x : 0;
    const posY =
      typeof tr?.position?.y === 'number' && Number.isFinite(tr.position.y) ? tr.position.y : 0;

    const anchor = tr?.anchor;
    const preset = typeof anchor?.preset === 'string' ? anchor.preset : 'center';
    const normalizedAnchor = (() => {
      switch (preset) {
        case 'topLeft':
          return { x: 0, y: 0 };
        case 'topRight':
          return { x: 1, y: 0 };
        case 'bottomLeft':
          return { x: 0, y: 1 };
        case 'bottomRight':
          return { x: 1, y: 1 };
        case 'custom': {
          const ax = typeof anchor?.x === 'number' && Number.isFinite(anchor.x) ? anchor.x : 0.5;
          const ay = typeof anchor?.y === 'number' && Number.isFinite(anchor.y) ? anchor.y : 0.5;
          return { x: Math.max(0, Math.min(1, ax)), y: Math.max(0, Math.min(1, ay)) };
        }
        case 'center':
        default:
          return { x: 0.5, y: 0.5 };
      }
    })();

    this.applyTransformLayout({
      clip,
      baseX,
      baseY,
      targetW,
      targetH,
      normalizedAnchor,
      scaleX,
      scaleY,
      rotationDeg,
      posX,
      posY,
    });
  }

  private applyTransformLayout(input: {
    clip: CompositorClip;
    baseX: number;
    baseY: number;
    targetW: number;
    targetH: number;
    normalizedAnchor: { x: number; y: number };
    scaleX: number;
    scaleY: number;
    rotationDeg: number;
    posX: number;
    posY: number;
  }) {
    input.clip.sprite.anchor.set(input.normalizedAnchor.x, input.normalizedAnchor.y);
    input.clip.sprite.width = input.targetW;
    input.clip.sprite.height = input.targetH;
    input.clip.sprite.scale.x *= input.scaleX;
    input.clip.sprite.scale.y *= input.scaleY;
    input.clip.sprite.rotation = (input.rotationDeg * Math.PI) / 180;

    const anchorOffsetX = input.normalizedAnchor.x * input.targetW;
    const anchorOffsetY = input.normalizedAnchor.y * input.targetH;
    input.clip.sprite.x = input.baseX + anchorOffsetX + input.posX;
    input.clip.sprite.y = input.baseY + anchorOffsetY + input.posY;
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

    const style = clip.style ?? {};
    const fontSize =
      typeof style.fontSize === 'number' && Number.isFinite(style.fontSize)
        ? Math.max(1, Math.min(1000, Math.round(style.fontSize)))
        : 64;
    const fontFamily =
      typeof style.fontFamily === 'string' && style.fontFamily.length > 0
        ? style.fontFamily
        : 'sans-serif';
    const fontWeight =
      typeof style.fontWeight === 'string' || typeof style.fontWeight === 'number'
        ? String(style.fontWeight)
        : '700';
    const color =
      typeof style.color === 'string' && style.color.length > 0 ? style.color : '#ffffff';
    const align =
      style.align === 'left' || style.align === 'center' || style.align === 'right'
        ? style.align
        : 'center';

    const verticalAlign =
      style.verticalAlign === 'top' ||
      style.verticalAlign === 'middle' ||
      style.verticalAlign === 'bottom'
        ? style.verticalAlign
        : 'middle';

    const lineHeightMultiplier =
      typeof style.lineHeight === 'number' && Number.isFinite(style.lineHeight)
        ? Math.max(0.1, Math.min(10, style.lineHeight))
        : 1.2;
    const lineHeightPx = Math.max(1, Math.round(fontSize * lineHeightMultiplier));

    const letterSpacing =
      typeof style.letterSpacing === 'number' && Number.isFinite(style.letterSpacing)
        ? Math.max(-1000, Math.min(1000, style.letterSpacing))
        : 0;

    const backgroundColor =
      typeof style.backgroundColor === 'string' && style.backgroundColor.trim().length > 0
        ? style.backgroundColor.trim()
        : '';

    const padding = (() => {
      const raw = (style as any).padding;
      const clampPadding = (v: unknown) =>
        typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(10_000, v)) : undefined;

      if (typeof raw === 'number') {
        const v = clampPadding(raw) ?? 0;
        return { top: v, right: v, bottom: v, left: v };
      }

      if (raw && typeof raw === 'object') {
        const anyPad = raw as any;
        const x = clampPadding(anyPad.x);
        const y = clampPadding(anyPad.y);
        const top = clampPadding(anyPad.top);
        const right = clampPadding(anyPad.right);
        const bottom = clampPadding(anyPad.bottom);
        const left = clampPadding(anyPad.left);

        const fromXY =
          x !== undefined || y !== undefined
            ? { top: y ?? 0, right: x ?? 0, bottom: y ?? 0, left: x ?? 0 }
            : undefined;
        const fromEdges =
          top !== undefined || right !== undefined || bottom !== undefined || left !== undefined
            ? { top: top ?? 0, right: right ?? 0, bottom: bottom ?? 0, left: left ?? 0 }
            : undefined;

        return fromEdges ?? fromXY ?? { top: 60, right: 60, bottom: 60, left: 60 };
      }

      return { top: 60, right: 60, bottom: 60, left: 60 };
    })();

    const safeW = Math.max(1, canvas.width);
    const safeH = Math.max(1, canvas.height);
    const boxX = Math.max(0, padding.left);
    const boxY = Math.max(0, padding.top);
    const boxW = Math.max(1, safeW - Math.max(0, padding.left) - Math.max(0, padding.right));
    const boxH = Math.max(1, safeH - Math.max(0, padding.top) - Math.max(0, padding.bottom));

    if (backgroundColor.length > 0) {
      ctx.save();
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(boxX, boxY, boxW, boxH);
      ctx.restore();
    }

    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'top';
    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;

    const rawText = String(clip.text ?? '');
    const paragraphs = rawText.split(/\r?\n/g);

    const wrapLine = (line: string): string[] => {
      const trimmed = String(line);
      if (trimmed.length === 0) return [''];

      const words = trimmed.split(/\s+/g);
      const lines: string[] = [];
      let curr = '';

      for (const w of words) {
        const next = curr.length > 0 ? `${curr} ${w}` : w;
        const width =
          ctx.measureText(next).width + Math.max(0, next.length - 1) * Math.max(0, letterSpacing);
        if (width <= boxW || curr.length === 0) {
          curr = next;
          continue;
        }
        lines.push(curr);
        curr = w;
      }
      lines.push(curr);
      return lines;
    };

    const lines = paragraphs.flatMap((p) => wrapLine(p));
    const textBlockH = lines.length * lineHeightPx;
    const startY =
      verticalAlign === 'top'
        ? boxY
        : verticalAlign === 'bottom'
          ? boxY + Math.max(0, boxH - textBlockH)
          : boxY + Math.max(0, (boxH - textBlockH) / 2);

    const startX = align === 'left' ? boxX : align === 'right' ? boxX + boxW : boxX + boxW / 2;

    const drawWithLetterSpacing = (text: string, x: number, y: number) => {
      if (!Number.isFinite(letterSpacing) || letterSpacing === 0) {
        ctx.fillText(text, x, y);
        return;
      }

      if (ctx.textAlign === 'center' || ctx.textAlign === 'right') {
        const baseWidth = ctx.measureText(text).width;
        const extra = Math.max(0, text.length - 1) * letterSpacing;
        const total = baseWidth + extra;
        const leftX = ctx.textAlign === 'center' ? x - total / 2 : x - total;

        let dx = leftX;
        for (let i = 0; i < text.length; i++) {
          const ch = text[i] ?? '';
          ctx.fillText(ch, dx, y);
          dx += ctx.measureText(ch).width + letterSpacing;
        }
        return;
      }

      let dx = x;
      for (let i = 0; i < text.length; i++) {
        const ch = text[i] ?? '';
        ctx.fillText(ch, dx, y);
        dx += ctx.measureText(ch).width + letterSpacing;
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const y = startY + i * lineHeightPx;
      drawWithLetterSpacing(line, startX, y);
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
    this.clips = [];
    this.clipById.clear();
    this.replacedClipIds.clear();
    this.lastRenderedTimeUs = 0;
    this.activeTracker.reset();
    this.stageSortDirty = true;
    this.activeSortDirty = true;
    this.maxDurationUs = 0;
  }

  destroy() {
    this.clearClips();
    if (this.adjustmentTexture) {
      safeDispose(this.adjustmentTexture);
      this.adjustmentTexture = null;
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
