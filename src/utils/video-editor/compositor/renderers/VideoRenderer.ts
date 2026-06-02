import { Sprite } from 'pixi.js';
import type { CompositorClip } from '../types';
import { safeDispose } from '../../utils';

export class VideoRenderer {
  public async updateClipTextureFromSample(sample: unknown, clip: CompositorClip) {
    if (clip.lastVideoFrame) {
      safeDispose(clip.lastVideoFrame);
      clip.lastVideoFrame = null;
    }

    const sprite = clip.sprite;
    if (!sprite || !(sprite instanceof Sprite)) return false;

    const isVideoFrame = typeof VideoFrame !== 'undefined' && sample instanceof VideoFrame;

    if (isVideoFrame) {
      clip.lastVideoFrame = sample;
      const frame = sample as VideoFrame;
      const frameW = Math.max(
        1,
        Math.round(
          Number((frame as { codedWidth?: unknown }).codedWidth ?? frame.displayWidth ?? 1),
        ),
      );
      const frameH = Math.max(
        1,
        Math.round(
          Number((frame as { codedHeight?: unknown }).codedHeight ?? frame.displayHeight ?? 1),
        ),
      );

      if (sprite.texture.source.width !== frameW || sprite.texture.source.height !== frameH) {
        if (typeof sprite.texture.source.resize === 'function') {
          sprite.texture.source.resize(frameW, frameH);
        }
      }

      (sprite.texture.source as unknown as { resource: unknown }).resource = frame;
      sprite.texture.source.update();
      return true;
    }

    // Fallback to canvas
    const sampleObj = sample as {
      draw?: () => void;
      toCanvasImageSource?: () => CanvasImageSource;
    };
    if (
      typeof sampleObj.draw === 'function' ||
      typeof sampleObj.toCanvasImageSource === 'function'
    ) {
      const imageSource: CanvasImageSource =
        typeof sampleObj.toCanvasImageSource === 'function'
          ? sampleObj.toCanvasImageSource()
          : (sample as CanvasImageSource);
      const imgAny = imageSource as {
        codedWidth?: number;
        displayWidth?: number;
        width?: number;
        codedHeight?: number;
        displayHeight?: number;
        height?: number;
      };
      const frameW = Math.max(
        1,
        Math.round(Number(imgAny.codedWidth ?? imgAny.displayWidth ?? imgAny.width ?? 1)),
      );
      const frameH = Math.max(
        1,
        Math.round(Number(imgAny.codedHeight ?? imgAny.displayHeight ?? imgAny.height ?? 1)),
      );

      this.ensureCanvasFallback(clip);
      const { ctx, canvas } = clip;
      if (!ctx || !canvas) return false;

      if (canvas.width !== frameW || canvas.height !== frameH) {
        canvas.width = frameW;
        canvas.height = frameH;
        if (typeof sprite.texture.source.resize === 'function') {
          sprite.texture.source.resize(frameW, frameH);
        }
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(imageSource as CanvasImageSource, 0, 0, frameW, frameH);
      sprite.texture.source.update();
      return true;
    }

    return false;
  }

  private ensureCanvasFallback(clip: CompositorClip) {
    if (!clip.canvas) {
      clip.canvas = new OffscreenCanvas(2, 2);
      clip.ctx = clip.canvas.getContext('2d');
    }
  }
}
