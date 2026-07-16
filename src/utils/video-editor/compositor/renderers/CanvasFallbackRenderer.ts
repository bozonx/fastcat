import { createDevLogger } from '~/utils/dev-logger';
import type { CompositorClip } from '../types';
import { CanvasSource, Texture } from 'pixi.js';
import type { LayoutApplier } from '../LayoutApplier';
const log = createDevLogger('CanvasFallbackRenderer');

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
    if (!clip.sprite) {
      throw new Error('Cannot ensure canvas fallback: clip.sprite is null');
    }
    const clipCanvas = new OffscreenCanvas(2, 2);
    const clipCtx = clipCanvas.getContext('2d');
    if (!clipCtx) {
      throw new Error('Failed to create 2D rendering context for clip canvas');
    }
    clip.canvas = clipCanvas;
    clip.ctx = clipCtx;
    const canvasSource = new CanvasSource({ resource: clipCanvas as import('pixi.js').ICanvas });
    const sprite = clip.sprite as import('pixi.js').Sprite;

    // Create a new unique Texture instead of mutating a shared Texture.EMPTY.
    // `dynamic`: the canvas is resized per drawn sample; without it the Sprite
    // keeps the stale quad size after a resize (it only listens to texture
    // updates when `dynamic` is true) and the content renders squashed.
    const texture = new Texture({ source: canvasSource, dynamic: true });
    sprite.texture = texture;

    clip.sourceKind = 'canvas';
  }

  public async drawSampleToCanvas(sample: unknown, clip: CompositorClip) {
    if (!clip.sprite) return;
    this.ensureCanvasFallback(clip);
    const ctx = clip.ctx;
    const canvas = clip.canvas;
    if (!ctx || !canvas) return;

    let imageSource: unknown;
    try {
      imageSource =
        typeof (sample as { toCanvasImageSource?: () => unknown }).toCanvasImageSource ===
        'function'
          ? (sample as { toCanvasImageSource: () => unknown }).toCanvasImageSource()
          : sample;
      const src = imageSource as {
        codedWidth?: number;
        displayWidth?: number;
        width?: number;
        codedHeight?: number;
        displayHeight?: number;
        height?: number;
      };
      // Display size, not coded size — coded includes codec alignment padding
      // that is never shown (see the videoFrame path in ClipResourceManager).
      const frameW = Math.max(
        1,
        Math.round(Number(src.displayWidth ?? src.codedWidth ?? src.width ?? 1)),
      );
      const frameH = Math.max(
        1,
        Math.round(Number(src.displayHeight ?? src.codedHeight ?? src.height ?? 1)),
      );

      if (canvas.width !== frameW || canvas.height !== frameH) {
        canvas.width = frameW;
        canvas.height = frameH;
        const texSource = (clip.sprite as import('pixi.js').Sprite).texture.source as {
          resize?: (w: number, h: number) => void;
        };
        if (typeof texSource.resize === 'function') {
          texSource.resize(frameW, frameH);
        }
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const preferBitmap = this.context.clipPreferBitmapFallback.get(clip.itemId) === true;

      try {
        if (preferBitmap) {
          throw new Error('Prefer createImageBitmap fallback');
        }
        ctx.drawImage(imageSource as CanvasImageSource, 0, 0, frameW, frameH);
        this.context.layoutApplier.applySpriteLayout(frameW, frameH, clip);
        (
          (clip.sprite as import('pixi.js').Sprite).texture.source as { update?: () => void }
        ).update?.();
        return;
      } catch (err) {
        this.context.clipPreferBitmapFallback.set(clip.itemId, true);
        log.warn('drawImage failed, trying createImageBitmap fallback:', err);
        try {
          const bmp = await createImageBitmap(imageSource as ImageBitmapSource);
          try {
            ctx.drawImage(bmp, 0, 0, frameW, frameH);
            this.context.layoutApplier.applySpriteLayout(frameW, frameH, clip);
            (
              (clip.sprite as import('pixi.js').Sprite).texture.source as { update?: () => void }
            ).update?.();
          } finally {
            bmp.close();
          }
          return;
        } catch (innerErr) {
          log.error('Fallback createImageBitmap failed:', innerErr);
          throw innerErr;
        }
      }
    } catch (err) {
      log.error('drawSampleToCanvas failed to draw image:', err);
    }

    if (typeof (sample as { draw?: unknown }).draw === 'function') {
      try {
        (
          sample as {
            draw: (
              ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
              x: number,
              y: number,
              w: number,
              h: number,
            ) => void;
          }
        ).draw(ctx, 0, 0, canvas.width, canvas.height);
        (
          (clip.sprite as import('pixi.js').Sprite).texture.source as { update?: () => void }
        ).update?.();
      } catch (err) {
        log.error('sample.draw failed:', err);
      }
      return;
    }
  }

  public drawHudClip(clip: CompositorClip, timeTicks: number) {
    if (clip.clipKind !== 'hud') return;
    if (!clip.canvas || !clip.ctx) return;

    const ctx = clip.ctx;
    const canvas = clip.canvas;

    const targetW = Math.max(1, Math.round(this.context.width));
    const targetH = Math.max(1, Math.round(this.context.height));
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
      if (!clip.sprite) return;
      try {
        if (
          typeof (
            (clip.sprite as import('pixi.js').Sprite).texture.source as {
              resize?: (w: number, h: number) => void;
            }
          ).resize === 'function'
        ) {
          (
            (clip.sprite as import('pixi.js').Sprite).texture.source as {
              resize: (w: number, h: number) => void;
            }
          ).resize(targetW, targetH);
        }
      } catch {
        // ignore
      }
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const type = clip.hudType ?? 'media_frame';
    if (type !== 'media_frame') return;

    const localTimeTicks = timeTicks - clip.startTicks;
    const clipEndTicks = clip.endTicks - clip.startTicks;

    const getLayerOpacity = (params?: import('../../../../timeline/types').HudMediaParams) => {
      let opacity = 1;
      if (!params) return opacity;
      if (params.transitionIn?.durationTicks && localTimeTicks < params.transitionIn.durationTicks) {
        opacity = Math.max(0, localTimeTicks / params.transitionIn.durationTicks);
      } else if (
        params.transitionOut?.durationTicks &&
        localTimeTicks > clipEndTicks - params.transitionOut.durationTicks
      ) {
        opacity = Math.max(0, (clipEndTicks - localTimeTicks) / params.transitionOut.durationTicks);
      }
      return opacity;
    };

    const drawLayer = (
      state:
        | { lastVideoFrame?: VideoFrame | ImageBitmap | null; bitmap?: ImageBitmap | null }
        | undefined,
      params: import('../../../../timeline/types').HudMediaParams | undefined,
      defaultScale: number = 1,
    ) => {
      if (!state || !(state.bitmap || state.lastVideoFrame)) return;
      const frame = state.bitmap || state.lastVideoFrame;
      if (!frame) return;
      const w =
        (frame as unknown as { displayWidth?: number; width?: number }).displayWidth ??
        (frame as unknown as { displayWidth?: number; width?: number }).width;
      const h =
        (frame as unknown as { displayHeight?: number; height?: number }).displayHeight ??
        (frame as unknown as { displayHeight?: number; height?: number }).height;
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

    if (!clip.sprite) return;
    try {
      (
        (clip.sprite as import('pixi.js').Sprite).texture.source as { update?: () => void }
      )?.update?.();
    } catch {
      // ignore
    }
  }
}
