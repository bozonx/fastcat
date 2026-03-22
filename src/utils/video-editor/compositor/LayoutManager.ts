import type { CompositorClip } from './types';
import {
  computeClipBoxLayout,
  computeCropMaskPolygon,
  resolveNormalizedAnchor,
} from '../clip-layout';
import { Graphics } from 'pixi.js';

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

    const anchor = resolveNormalizedAnchor(clip.transform?.anchor);
    if (clip.sprite.anchor) {
      clip.sprite.anchor.set(anchor.x, anchor.y);
    }

    clip.sprite.width = box.targetWidth;
    clip.sprite.height = box.targetHeight;
    if (clip.sprite.scale) {
      clip.sprite.scale.x = Math.abs(clip.sprite.scale.x) * box.scaleX;
      clip.sprite.scale.y = Math.abs(clip.sprite.scale.y) * box.scaleY;
    }
    clip.sprite.rotation = (box.rotationDeg * Math.PI) / 180;
    clip.sprite.x = box.baseX + anchor.x * box.targetWidth + box.stagePositionX;
    clip.sprite.y = box.baseY + anchor.y * box.targetHeight + box.stagePositionY;
    clip.sprite.alpha = clip.opacity ?? 1;

    this.applyCropMask(clip, box.targetWidth, box.targetHeight, anchor, box.scaleX, box.scaleY);
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

    const anchor = resolveNormalizedAnchor(clip.transform?.anchor);
    if (clip.sprite.anchor) {
      clip.sprite.anchor.set(anchor.x, anchor.y);
    }

    clip.sprite.width = box.targetWidth;
    clip.sprite.height = box.targetHeight;
    if (clip.sprite.scale) {
      clip.sprite.scale.x = Math.abs(clip.sprite.scale.x) * box.scaleX;
      clip.sprite.scale.y = Math.abs(clip.sprite.scale.y) * box.scaleY;
    }
    clip.sprite.rotation = (box.rotationDeg * Math.PI) / 180;
    clip.sprite.x = box.baseX + anchor.x * box.targetWidth + box.stagePositionX;
    clip.sprite.y = box.baseY + anchor.y * box.targetHeight + box.stagePositionY;
    clip.sprite.alpha = clip.opacity ?? 1;

    this.applyCropMask(clip, box.targetWidth, box.targetHeight, anchor, box.scaleX, box.scaleY);
  }

  private applyCropMask(
    clip: CompositorClip,
    targetW: number,
    targetH: number,
    normalizedAnchor: { x: number; y: number },
    scaleX: number,
    scaleY: number,
  ) {
    const sprite = clip.sprite;
    if (!sprite) return;

    const crop = clip.transform?.crop;
    if (crop && (crop.top || crop.bottom || crop.left || crop.right)) {
      if (!clip.cropMask) {
        clip.cropMask = new Graphics();
        if (sprite.parent) {
          sprite.parent.addChild(clip.cropMask);
        } else {
          sprite.addChild(clip.cropMask);
        }
        sprite.mask = clip.cropMask;
      } else if (sprite.parent && clip.cropMask.parent !== sprite.parent) {
        sprite.parent.addChild(clip.cropMask);
      }

      const mask = clip.cropMask as Graphics;
      mask.clear();

      const { points } = computeCropMaskPolygon({
        crop,
        targetW,
        targetH,
        anchorX: normalizedAnchor.x,
        anchorY: normalizedAnchor.y,
        scaleX,
        scaleY,
        rotationRad: sprite.rotation ?? 0,
        spritePosX: sprite.x,
        spritePosY: sprite.y,
      });

      // Reset mask transform — polygon is already in world/parent coordinates
      mask.x = 0;
      mask.y = 0;
      mask.rotation = 0;
      mask.scale.set(1, 1);
      mask.pivot.set(0, 0);

      mask.poly(points);
      mask.fill(0xffffff);
    } else if (clip.cropMask) {
      if (typeof clip.cropMask.destroy === 'function') {
        clip.cropMask.destroy();
      }
      clip.cropMask = undefined;
      sprite.mask = null;
    }
  }
}
