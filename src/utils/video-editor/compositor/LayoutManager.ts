import type { CompositorClip } from './types';
import { computeClipBoxLayout, resolveNormalizedAnchor } from '../clip-layout';

export interface LayoutManagerContext {
  width: number;
  height: number;
}

export class LayoutManager {
  public applySolidLayout(clip: CompositorClip, context: LayoutManagerContext) {
    const box = computeClipBoxLayout({
      canvasWidth: context.width,
      canvasHeight: context.height,
      frameWidth: context.width,
      frameHeight: context.height,
      transform: clip.transform,
    });

    clip.sprite.x = box.stagePositionX;
    clip.sprite.y = box.stagePositionY;
    clip.sprite.width = box.targetWidth;
    clip.sprite.height = box.targetHeight;
    clip.sprite.angle = box.rotationDeg;
    clip.sprite.alpha = clip.opacity ?? 1;

    const anchor = resolveNormalizedAnchor(clip.transform?.anchor);
    if (clip.sprite.anchor) {
      clip.sprite.anchor.set(anchor.x, anchor.y);
    }
  }

  public applySpriteLayout(
    frameW: number,
    frameH: number,
    clip: CompositorClip,
    context: LayoutManagerContext,
  ) {
    const box = computeClipBoxLayout({
      canvasWidth: context.width,
      canvasHeight: context.height,
      frameWidth: frameW,
      frameHeight: frameH,
      transform: clip.transform,
    });

    clip.sprite.x = box.stagePositionX;
    clip.sprite.y = box.stagePositionY;
    clip.sprite.width = box.targetWidth;
    clip.sprite.height = box.targetHeight;
    clip.sprite.angle = box.rotationDeg;
    clip.sprite.alpha = clip.opacity ?? 1;

    const anchor = resolveNormalizedAnchor(clip.transform?.anchor);
    if (clip.sprite.anchor) {
      clip.sprite.anchor.set(anchor.x, anchor.y);
    }
  }
}
