import type { CompositorClip } from '../types';
import { CanvasSource } from 'pixi.js';
import type { LayoutApplier } from '../LayoutApplier';

export interface CanvasFallbackRendererContext {
  width: number;
  height: number;
  layoutApplier: LayoutApplier;
  clipPreferBitmapFallback: Map<string, boolean>;
}

export class CanvasFallbackRenderer {
  constructor(private readonly context: CanvasFallbackRendererContext) {}

  public ensureCanvasFallback(clip: CompositorClip) {
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

  public async drawSampleToCanvas(sample: any, clip: CompositorClip) {
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

      const preferBitmap = this.context.clipPreferBitmapFallback.get(clip.itemId) === true;

      try {
        if (preferBitmap) {
          throw new Error('Prefer createImageBitmap fallback');
        }
        ctx.drawImage(imageSource, 0, 0, frameW, frameH);
        this.context.layoutApplier.applySpriteLayout(frameW, frameH, clip);
        clip.sprite.texture.source.update();
        return;
      } catch (err) {
        this.context.clipPreferBitmapFallback.set(clip.itemId, true);
        console.warn(
          '[CanvasFallbackRenderer] drawImage failed, trying createImageBitmap fallback:',
          err,
        );
        try {
          const bmp = await createImageBitmap(imageSource);
          ctx.drawImage(bmp, 0, 0, frameW, frameH);
          this.context.layoutApplier.applySpriteLayout(frameW, frameH, clip);
          clip.sprite.texture.source.update();
          bmp.close();
          return;
        } catch (innerErr) {
          console.error('[CanvasFallbackRenderer] Fallback createImageBitmap failed:', innerErr);
          throw innerErr;
        }
      }
    } catch (err) {
      console.error('[CanvasFallbackRenderer] drawSampleToCanvas failed to draw image:', err);
    }

    if (typeof sample.draw === 'function') {
      try {
        sample.draw(ctx, 0, 0, canvas.width, canvas.height);
        clip.sprite.texture.source.update();
      } catch (err) {
        console.error('[CanvasFallbackRenderer] sample.draw failed:', err);
      }
      return;
    }
  }

  public drawHudClip(clip: CompositorClip, timeUs: number) {
    if (clip.clipKind !== 'hud') return;
    if (!clip.canvas || !clip.ctx) return;

    const ctx = clip.ctx;
    const canvas = clip.canvas;

    const targetW = Math.max(1, Math.round(this.context.width));
    const targetH = Math.max(1, Math.round(this.context.height));
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

    const type = clip.hudType ?? 'media_frame';
    if (type !== 'media_frame') return;

    const localTimeUs = timeUs - clip.startUs;
    const clipEndUs = clip.endUs - clip.startUs;

    const getLayerOpacity = (params?: import('../../../../timeline/types').HudMediaParams) => {
      let opacity = 1;
      if (!params) return opacity;
      if (params.transitionIn?.durationUs && localTimeUs < params.transitionIn.durationUs) {
        opacity = Math.max(0, localTimeUs / params.transitionIn.durationUs);
      } else if (params.transitionOut?.durationUs && localTimeUs > clipEndUs - params.transitionOut.durationUs) {
        opacity = Math.max(0, (clipEndUs - localTimeUs) / params.transitionOut.durationUs);
      }
      return opacity;
    };

    const drawLayer = (
      state: any,
      params: import('../../../../timeline/types').HudMediaParams | undefined,
      defaultScale: number = 1,
    ) => {
      if (!state || !(state.bitmap || state.lastVideoFrame)) return;
      const frame = state.bitmap || state.lastVideoFrame;
      const w = frame.displayWidth ?? frame.width;
      const h = frame.displayHeight ?? frame.height;
      if (!w || !h) return;

      const layerOpacity = getLayerOpacity(params);
      if (layerOpacity <= 0) return;

      ctx.save();
      ctx.globalAlpha = layerOpacity;

      const scaleX = params?.scaleX ?? 100;
      const scaleY = params?.scaleY ?? 100;
      const offsetX = params?.offsetX ?? 0;
      const offsetY = params?.offsetY ?? 0;

      const aspect = w / h;
      let targetW = canvas.width;
      let targetH = canvas.width / aspect;
      if (targetH > canvas.height) {
        targetH = canvas.height;
        targetW = targetH * aspect;
      }

      const sw = targetW * (scaleX / 100) * defaultScale;
      const sh = targetH * (scaleY / 100) * defaultScale;

      const cx = canvas.width / 2 + canvas.width * (offsetX / 100);
      const cy = canvas.height / 2 + canvas.height * (offsetY / 100);

      if (params?.shadow?.enabled) {
        ctx.shadowColor = params.shadow.color ?? '#000000';
        ctx.shadowBlur = params.shadow.blur ?? 10;
        ctx.shadowOffsetX = params.shadow.offsetX ?? 5;
        ctx.shadowOffsetY = params.shadow.offsetY ?? 5;
      }

      ctx.translate(cx, cy);
      ctx.drawImage(frame as CanvasImageSource, -sw / 2, -sh / 2, sw, sh);
      ctx.restore();
    };

    drawLayer(clip.hudMediaStates?.background, clip.background, 1.0);
    drawLayer(clip.hudMediaStates?.content, clip.content, 0.75);
    drawLayer(clip.hudMediaStates?.frame, clip.frame, 1.0);

    try {
      (clip.sprite.texture.source as any)?.update?.();
    } catch {
      // ignore
    }
  }
}
