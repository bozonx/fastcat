import { Application, Sprite, Texture, CanvasSource, DOMAdapter, WebWorkerAdapter } from 'pixi.js';
import type { Input, VideoSampleSink } from 'mediabunny';

export interface CompositorClip {
  itemId: string;
  sourcePath: string;
  fileHandle: FileSystemFileHandle;
  input: Input;
  sink: VideoSampleSink;
  startUs: number;
  endUs: number;
  durationUs: number;
  sourceStartUs: number;
  sourceDurationUs: number;
  sprite: Sprite;
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
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

  async init(
    width: number,
    height: number,
    bgColor = '#000',
    offscreen = true,
    externalCanvas?: OffscreenCanvas | HTMLCanvasElement
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
      const source = new BlobSource(file);
      const input = new Input({ source, formats: ALL_FORMATS } as any);
      const track = await input.getPrimaryVideoTrack();

      if (!track || !(await track.canDecode())) {
        this.disposeResource(input);
        continue;
      }

      const sink = new VideoSampleSink(track);
      const mediaDurationUs = Math.max(0, Math.floor((await track.computeDuration()) * 1_000_000));
      const maxSourceTailUs = Math.max(0, mediaDurationUs - sourceStartUs);
      const sourceDurationUs =
        requestedSourceDurationUs > 0
          ? Math.min(requestedSourceDurationUs, maxSourceTailUs)
          : maxSourceTailUs;
      const durationUs =
        requestedTimelineDurationUs > 0 ? requestedTimelineDurationUs : sourceDurationUs;
      const endUs = startUs + durationUs;

      sequentialTimeUs = Math.max(sequentialTimeUs, endUs);

      // Keep small per-clip backing canvas. It will be resized lazily to source frame size.
      const clipCanvas = new OffscreenCanvas(2, 2);
      const clipCtx = clipCanvas.getContext('2d')!;

      const canvasSource = new CanvasSource({ resource: clipCanvas as any });
      const texture = new Texture({ source: canvasSource });
      const sprite = new Sprite(texture);

      sprite.width = 1;
      sprite.height = 1;
      sprite.visible = false;

      this.app.stage.addChild(sprite);

      const compositorClip: CompositorClip = {
        itemId,
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
        canvas: clipCanvas,
        ctx: clipCtx,
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
    this.maxDurationUs = this.clips.length > 0 ? Math.max(0, ...this.clips.map(c => c.endUs)) : 0;

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

      clip.startUs = startUs;
      clip.durationUs = timelineDurationUs;
      clip.endUs = startUs + timelineDurationUs;
      clip.sourceStartUs = sourceStartUs;
      clip.sourceDurationUs = sourceDurationUs;
    }

    this.maxDurationUs = this.clips.length > 0 ? Math.max(0, ...this.clips.map(c => c.endUs)) : 0;
    return this.maxDurationUs;
  }

  async renderFrame(timeUs: number): Promise<OffscreenCanvas | HTMLCanvasElement | null> {
    if (!this.app || !this.canvas) return null;

    for (const clip of this.clips) {
      if (timeUs >= clip.startUs && timeUs < clip.endUs) {
        const localTimeUs = timeUs - clip.startUs;
        if (localTimeUs < 0 || localTimeUs >= clip.sourceDurationUs) {
          clip.sprite.visible = false;
          continue;
        }

        const sampleTimeS = (clip.sourceStartUs + localTimeUs) / 1_000_000;
        try {
          const sample = await clip.sink.getSample(sampleTimeS);

          if (sample) {
            await this.drawSampleToCanvas(sample, clip);
            clip.sprite.texture.source.update();
            clip.sprite.visible = true;

            if ('close' in sample) (sample as any).close();
          } else {
            clip.sprite.visible = false;
          }
        } catch (e) {
          console.error('[VideoCompositor] Failed to render sample', e);
        }
      } else {
        clip.sprite.visible = false;
      }
    }

    this.app.render();
    return this.canvas;
  }

  private async drawSampleToCanvas(sample: any, clip: CompositorClip) {
    let imageSource: any;
    try {
      imageSource =
        typeof sample.toCanvasImageSource === 'function' ? sample.toCanvasImageSource() : sample;
      const frameW = Math.max(1, Math.round(imageSource?.displayWidth ?? imageSource?.width ?? 1));
      const frameH = Math.max(
        1,
        Math.round(imageSource?.displayHeight ?? imageSource?.height ?? 1),
      );

      if (clip.canvas.width !== frameW || clip.canvas.height !== frameH) {
        clip.canvas.width = frameW;
        clip.canvas.height = frameH;
      }

      clip.ctx.clearRect(0, 0, clip.canvas.width, clip.canvas.height);

      const viewportScale = Math.min(this.width / frameW, this.height / frameH);
      const targetW = frameW * viewportScale;
      const targetH = frameH * viewportScale;
      const targetX = (this.width - targetW) / 2;
      const targetY = (this.height - targetH) / 2;

      try {
        clip.ctx.drawImage(imageSource, 0, 0, frameW, frameH);
        clip.sprite.x = targetX;
        clip.sprite.y = targetY;
        clip.sprite.width = targetW;
        clip.sprite.height = targetH;
        return;
      } catch (err) {
        // Fallback for some browsers where drawImage fails on VideoFrame
        const bmp = await createImageBitmap(imageSource);
        clip.ctx.drawImage(bmp, 0, 0, frameW, frameH);
        clip.sprite.x = targetX;
        clip.sprite.y = targetY;
        clip.sprite.width = targetW;
        clip.sprite.height = targetH;
        bmp.close();
        return;
      }
    } catch (err) {
      // ignore
    }

    if (typeof sample.draw === 'function') {
      sample.draw(clip.ctx, 0, 0, clip.canvas.width, clip.canvas.height);
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
    if (clip.sprite && clip.sprite.parent) {
      clip.sprite.parent.removeChild(clip.sprite);
    }
    clip.sprite.destroy(true);
  }
}
