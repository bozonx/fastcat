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

  public drawHudClip(clip: CompositorClip) {
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
}
