import type { CompositorClip } from '../types';
import { safeDispose } from '../../utils';

export class VideoRenderer {
  public async updateClipTextureFromSample(sample: any, clip: CompositorClip) {
    if (clip.lastVideoFrame) {
      safeDispose(clip.lastVideoFrame);
      clip.lastVideoFrame = null;
    }

    const isVideoFrame = typeof VideoFrame !== 'undefined' && sample instanceof VideoFrame;

    if (isVideoFrame) {
      clip.lastVideoFrame = sample;
      const frame = sample as VideoFrame;
      const frameW = frame.displayWidth;
      const frameH = frame.displayHeight;

      if (
        clip.sprite.texture.source.width !== frameW ||
        clip.sprite.texture.source.height !== frameH
      ) {
        if (typeof clip.sprite.texture.source.resize === 'function') {
          clip.sprite.texture.source.resize(frameW, frameH);
        }
      }

      (clip.sprite.texture.source as any).resource = frame;
      clip.sprite.texture.source.update();
      return true;
    }

    // Fallback to canvas
    if (typeof sample.draw === 'function' || typeof sample.toCanvasImageSource === 'function') {
      const imageSource =
        typeof sample.toCanvasImageSource === 'function' ? sample.toCanvasImageSource() : sample;
      const frameW = Math.max(1, Math.round(imageSource?.displayWidth ?? imageSource?.width ?? 1));
      const frameH = Math.max(
        1,
        Math.round(imageSource?.displayHeight ?? imageSource?.height ?? 1),
      );

      this.ensureCanvasFallback(clip);
      const { ctx, canvas } = clip;
      if (!ctx || !canvas) return false;

      if (canvas.width !== frameW || canvas.height !== frameH) {
        canvas.width = frameW;
        canvas.height = frameH;
        if (typeof clip.sprite.texture.source.resize === 'function') {
          clip.sprite.texture.source.resize(frameW, frameH);
        }
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(imageSource, 0, 0, frameW, frameH);
      clip.sprite.texture.source.update();
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
