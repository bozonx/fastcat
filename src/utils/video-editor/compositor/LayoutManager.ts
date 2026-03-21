import type { CompositorClip } from './types';
import { computeClipBoxLayout, resolveNormalizedAnchor } from '../clip-layout';
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
    
    this.applyCropMask(clip, box.targetWidth, box.targetHeight);
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
    
    this.applyCropMask(clip, box.targetWidth, box.targetHeight);
  }

  private applyCropMask(clip: CompositorClip, targetW: number, targetH: number) {
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
      
      const t = Math.max(0, Math.min(100, crop.top ?? 0)) / 100 * targetH;
      const b = Math.max(0, Math.min(100, crop.bottom ?? 0)) / 100 * targetH;
      const l = Math.max(0, Math.min(100, crop.left ?? 0)) / 100 * targetW;
      const r = Math.max(0, Math.min(100, crop.right ?? 0)) / 100 * targetW;
      
      const cw = Math.max(1, targetW - l - r);
      const ch = Math.max(1, targetH - t - b);
      
      mask.rect(0, 0, cw, ch);
      mask.fill(0xffffff);
      
      const anchorX = sprite.anchor?.x ?? 0;
      const anchorY = sprite.anchor?.y ?? 0;
      
      mask.pivot.set(anchorX * targetW, anchorY * targetH);
      
      const scaleX = sprite.scale?.x ?? 1;
      const scaleY = sprite.scale?.y ?? 1;
      mask.scale.set(Math.sign(scaleX), Math.sign(scaleY));
      mask.rotation = sprite.rotation ?? 0;
      
      const localOffsetX = l - (anchorX * targetW);
      const localOffsetY = t - (anchorY * targetH);
      
      const rotation = sprite.rotation ?? 0;
      const cosR = Math.cos(rotation);
      const sinR = Math.sin(rotation);
      
      const rx = localOffsetX * cosR - localOffsetY * sinR;
      const ry = localOffsetX * sinR + localOffsetY * cosR;
      
      mask.x = sprite.x + rx * Math.sign(scaleX);
      mask.y = sprite.y + ry * Math.sign(scaleY);
      
    } else if (clip.cropMask) {
      if (typeof clip.cropMask.destroy === 'function') {
        clip.cropMask.destroy();
      }
      clip.cropMask = undefined;
      sprite.mask = null;
    }
  }
}
