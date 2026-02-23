import {
  Application,
  Sprite,
  Texture,
  CanvasSource,
  ImageSource,
  DOMAdapter,
  WebWorkerAdapter,
} from 'pixi.js';
import type { Input, VideoSampleSink } from 'mediabunny';

export async function getVideoSampleWithZeroFallback(
  sink: Pick<VideoSampleSink, 'getSample'>,
  timeS: number,
): Promise<any | null> {
  const primary = await sink.getSample(timeS);
  if (primary) return primary;

  if (timeS !== 0) {
    return null;
  }

  // Some decoders return null for exact 0.0 but can provide the first frame for a tiny epsilon.
  return sink.getSample(1e-6);
}

export interface CompositorClip {
  itemId: string;
  layer: number;
  sourcePath: string;
  fileHandle: FileSystemFileHandle;
  input?: Input;
  sink?: VideoSampleSink;
  startUs: number;
  endUs: number;
  durationUs: number;
  sourceStartUs: number;
  sourceDurationUs: number;
  sprite: Sprite;
  clipKind: 'video' | 'image';
  sourceKind: 'videoFrame' | 'canvas' | 'bitmap';
  imageSource: ImageSource;
  lastVideoFrame: VideoFrame | null;
  canvas: OffscreenCanvas | null;
  ctx: OffscreenCanvasRenderingContext2D | null;
  bitmap: ImageBitmap | null;
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
  }

  async loadTimeline(
    timelineClips: any[],
    getFileHandleByPath: (path: string) => Promise<FileSystemFileHandle | null>,
  ): Promise<number> {
    if (!this.app) throw new Error('VideoCompositor not initialized');

    const { Input, BlobSource, VideoSampleSink, ALL_FORMATS } = await import('mediabunny');

    const nextClips: CompositorClip[] = [];
    const nextClipById = new Map<string, CompositorClip>();
    let sequentialTimeUs = 0; // For fallback if startUs is missing

    for (const [index, clipData] of timelineClips.entries()) {
      if (clipData.kind !== 'clip') continue;

      const itemId =
        typeof clipData.id === 'string' && clipData.id.length > 0 ? clipData.id : `clip_${index}`;
      const sourcePath =
        typeof clipData?.source?.path === 'string' && clipData.source.path.length > 0
          ? clipData.source.path
          : '';

      const sourceStartUs = Math.max(0, Math.round(Number(clipData.sourceRange?.startUs ?? 0)));
      const layer = Math.round(Number(clipData.layer ?? 0));
      const requestedTimelineDurationUs = Math.max(
        0,
        Math.round(Number(clipData.timelineRange?.durationUs ?? 0)),
      );
      const requestedSourceDurationUs = Math.max(
        0,
        Math.round(Number(clipData.sourceRange?.durationUs ?? requestedTimelineDurationUs)),
      );

      const startUs =
        typeof clipData.timelineRange?.startUs === 'number'
          ? Math.max(0, Math.round(Number(clipData.timelineRange.startUs)))
          : sequentialTimeUs;

      const reusable = this.clipById.get(itemId);
      if (reusable && reusable.sourcePath === sourcePath) {
        const safeSourceDurationUs =
          requestedSourceDurationUs > 0 ? requestedSourceDurationUs : reusable.sourceDurationUs;
        const safeTimelineDurationUs =
          requestedTimelineDurationUs > 0 ? requestedTimelineDurationUs : safeSourceDurationUs;

        reusable.startUs = startUs;
        reusable.durationUs = safeTimelineDurationUs;
        reusable.endUs = startUs + safeTimelineDurationUs;
        reusable.sourceStartUs = sourceStartUs;
        reusable.sourceDurationUs = safeSourceDurationUs;
        reusable.layer = layer;
        reusable.sprite.visible = false;

        nextClips.push(reusable);
        nextClipById.set(itemId, reusable);
        sequentialTimeUs = Math.max(sequentialTimeUs, reusable.endUs);
        continue;
      }

      if (!sourcePath) continue;

      if (reusable) {
        this.destroyClip(reusable);
        this.replacedClipIds.add(itemId);
      }

      const fileHandle = await getFileHandleByPath(sourcePath);
      if (!fileHandle) continue;

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
          sprite,
          clipKind: 'image',
          sourceKind: 'bitmap',
          imageSource,
          lastVideoFrame: null,
          canvas: null,
          ctx: null,
          bitmap: bmp,
        };

        nextClips.push(compositorClip);
        nextClipById.set(itemId, compositorClip);
        continue;
      }

      const source = new BlobSource(file);
      const input = new Input({ source, formats: ALL_FORMATS } as any);
      const track = await input.getPrimaryVideoTrack();

      if (!track || !(await track.canDecode())) {
        this.disposeResource(input);
        continue;
      }

      const sink = new VideoSampleSink(track);
      const mediaDurationUs = Math.max(0, Math.round((await track.computeDuration()) * 1_000_000));
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
        startUs,
        endUs,
        durationUs,
        sourceStartUs,
        sourceDurationUs,
        sprite,
        clipKind: 'video',
        sourceKind: 'videoFrame',
        imageSource,
        lastVideoFrame: null,
        canvas: null,
        ctx: null,
        bitmap: null,
      };

      nextClips.push(compositorClip);
      nextClipById.set(itemId, compositorClip);
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
    this.maxDurationUs = this.clips.length > 0 ? Math.max(0, ...this.clips.map((c) => c.endUs)) : 0;

    this.lastRenderedTimeUs = 0;

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

      clip.startUs = startUs;
      clip.durationUs = timelineDurationUs;
      clip.endUs = startUs + timelineDurationUs;
      clip.sourceStartUs = sourceStartUs;
      clip.sourceDurationUs = sourceDurationUs;
      clip.layer = layer;
    }

    this.clips.sort((a, b) => a.startUs - b.startUs || a.layer - b.layer);
    this.maxDurationUs = this.clips.length > 0 ? Math.max(0, ...this.clips.map((c) => c.endUs)) : 0;

    this.lastRenderedTimeUs = 0;
    return this.maxDurationUs;
  }

  async renderFrame(timeUs: number): Promise<OffscreenCanvas | HTMLCanvasElement | null> {
    if (!this.app || !this.canvas) return null;

    this.lastRenderedTimeUs = timeUs;

    const active: CompositorClip[] = [];
    for (const clip of this.clips) {
      if (timeUs < clip.startUs || timeUs >= clip.endUs) {
        clip.sprite.visible = false;
        continue;
      }
      active.push(clip);
    }

    active.sort((a, b) => a.layer - b.layer || a.startUs - b.startUs);

    for (const clip of active) {
      if (clip.clipKind === 'image') {
        clip.sprite.visible = true;
        continue;
      }

      const localTimeUs = timeUs - clip.startUs;
      if (localTimeUs < 0 || localTimeUs >= clip.sourceDurationUs) {
        clip.sprite.visible = false;
        continue;
      }

      const sampleTimeS = (clip.sourceStartUs + localTimeUs) / 1_000_000;
      try {
        if (!clip.sink) {
          clip.sprite.visible = false;
          continue;
        }

        const sample = await getVideoSampleWithZeroFallback(clip.sink, sampleTimeS);
        if (sample) {
          await this.updateClipTextureFromSample(sample, clip);
          clip.sprite.visible = true;

          if (typeof (clip.sprite as any).setChildIndex === 'function') {
            // noop: setChildIndex exists on containers, not on sprites
          }
        } else {
          clip.sprite.visible = false;
        }
      } catch (e) {
        console.error('[VideoCompositor] Failed to render sample', e);
        clip.sprite.visible = false;
      }
    }

    // Ensure stage ordering matches layer ordering for correct blending
    this.app.stage.children.sort((a: any, b: any) => {
      const aClip = this.clipById.get((a as any).__clipId ?? '') as any;
      const bClip = this.clipById.get((b as any).__clipId ?? '') as any;
      const aLayer = typeof aClip?.layer === 'number' ? aClip.layer : 0;
      const bLayer = typeof bClip?.layer === 'number' ? bClip.layer : 0;
      return aLayer - bLayer;
    });

    this.app.render();

    // After rendering, it's safe to close the previous frame resources.
    for (const c of this.clips) {
      if (c.lastVideoFrame) {
        try {
          c.lastVideoFrame.close();
        } catch {
          // ignore
        }
        c.lastVideoFrame = null;
      }
    }
    return this.canvas;
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

        // Close the VideoSample immediately, but keep the VideoFrame alive until after render.
        if ('close' in sample) (sample as any).close();
        clip.lastVideoFrame = frame;
        return;
      }
    } catch (err) {
      this.clipPreferCanvasFallback.set(clip.itemId, true);
      console.warn('[VideoCompositor] VideoFrame path failed, falling back to canvas:', err);
    }

    // Fallback: draw into 2D canvas and upload.
    await this.drawSampleToCanvas(sample, clip);
    if ('close' in sample) (sample as any).close();
  }

  private applySpriteLayout(frameW: number, frameH: number, clip: CompositorClip) {
    const viewportScale = Math.min(this.width / frameW, this.height / frameH);
    const targetW = frameW * viewportScale;
    const targetH = frameH * viewportScale;
    const targetX = (this.width - targetW) / 2;
    const targetY = (this.height - targetH) / 2;
    clip.sprite.x = targetX;
    clip.sprite.y = targetY;
    clip.sprite.width = targetW;
    clip.sprite.height = targetH;
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
    this.maxDurationUs = 0;
  }

  destroy() {
    this.clearClips();
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
    this.canvas = null;
  }

  private disposeResource(resource: unknown) {
    if (!resource || typeof resource !== 'object') return;
    if (
      'dispose' in resource &&
      typeof (resource as { dispose?: unknown }).dispose === 'function'
    ) {
      (resource as { dispose: () => void }).dispose();
      return;
    }
    if ('close' in resource && typeof (resource as { close?: unknown }).close === 'function') {
      (resource as { close: () => void }).close();
    }
  }

  private destroyClip(clip: CompositorClip) {
    this.disposeResource(clip.sink);
    this.disposeResource(clip.input);
    if (clip.lastVideoFrame) {
      try {
        clip.lastVideoFrame.close();
      } catch {
        // ignore
      }
      clip.lastVideoFrame = null;
    }

    if (clip.bitmap) {
      try {
        clip.bitmap.close();
      } catch {
        // ignore
      }
      clip.bitmap = null;
    }

    if (clip.sprite && clip.sprite.parent) {
      clip.sprite.parent.removeChild(clip.sprite);
    }
    clip.sprite.destroy(true);
  }
}
