import {
  computeClipBoxLayout,
  computeCropMaskPolygon,
  TRANSFORM_DESIGN_BASE,
  resolveNormalizedAnchor,
} from '../clip-layout';
import { computeTextLayoutMetrics } from '../text-layout';
import type { CompositorClip } from './types';
import { Graphics } from 'pixi.js';

export interface LayoutApplierContext {
  width: number;
  height: number;
}

export class LayoutApplier {
  constructor(private readonly context: LayoutApplierContext) {}

  public applySolidLayout(clip: CompositorClip) {
    const layout = computeClipBoxLayout({
      frameWidth: this.context.width,
      frameHeight: this.context.height,
      canvasWidth: this.context.width,
      canvasHeight: this.context.height,
      transform: clip.transform,
    });

    this.applyTransformLayout({
      clip,
      baseX: layout.baseX,
      baseY: layout.baseY,
      targetW: layout.targetWidth,
      targetH: layout.targetHeight,
      anchorOffsetX: layout.anchorOffsetX,
      anchorOffsetY: layout.anchorOffsetY,
      normalizedAnchor: { x: layout.anchorX, y: layout.anchorY },
      scaleX: layout.scaleX,
      scaleY: layout.scaleY,
      rotationDeg: layout.rotationDeg,
      stagePosX: layout.stagePositionX,
      stagePosY: layout.stagePositionY,
    });
  }

  public applyShapeLayout(clip: CompositorClip) {
    const size = Math.min(this.context.width, this.context.height) * 0.8;
    const strokeWidth = clip.strokeWidth ?? 0;
    const targetW = Math.max(1, Math.ceil(size + strokeWidth * 2));
    const targetH = Math.max(1, Math.ceil(size + strokeWidth * 2));
    const baseX = (this.context.width - targetW) / 2;
    const baseY = (this.context.height - targetH) / 2;

    this.applyScreenSpaceLayout(clip, baseX, baseY, targetW, targetH);
  }

  public applyTextLayout(clip: CompositorClip) {
    if (!clip.ctx) return;
    const layout = computeTextLayoutMetrics({
      text: String(clip.text ?? ''),
      style: clip.style,
      canvasWidth: this.context.width,
      canvasHeight: this.context.height,
      measureText: (text, font) => {
        clip.ctx!.font = font;
        return clip.ctx!.measureText(text).width;
      },
    });

    const w = Math.max(1, Math.ceil(layout.backgroundWidth));
    const h = Math.max(1, Math.ceil(layout.backgroundHeight));
    const baseX = layout.backgroundX;
    const baseY = layout.backgroundY;

    this.applyScreenSpaceLayout(clip, baseX, baseY, w, h);
  }

  public applyClipLayoutForCurrentSource(clip: CompositorClip) {
    if (clip.clipKind === 'text') {
      this.applyTextLayout(clip);
      return;
    }
    if (clip.clipKind === 'shape') {
      this.applyShapeLayout(clip);
      return;
    }
    if (clip.clipKind === 'solid' || clip.clipKind === 'adjustment' || clip.clipKind === 'hud') {
      this.applySolidLayout(clip);
      return;
    }

    const frameW = Math.max(1, Math.round(clip.imageSource?.width ?? 1));
    const frameH = Math.max(1, Math.round(clip.imageSource?.height ?? 1));
    this.applySpriteLayout(frameW, frameH, clip);
  }

  public applySpriteLayout(frameW: number, frameH: number, clip: CompositorClip) {
    const layout = computeClipBoxLayout({
      frameWidth: frameW,
      frameHeight: frameH,
      canvasWidth: this.context.width,
      canvasHeight: this.context.height,
      transform: clip.transform,
    });

    this.applyTransformLayout({
      clip,
      baseX: layout.baseX,
      baseY: layout.baseY,
      targetW: layout.targetWidth,
      targetH: layout.targetHeight,
      anchorOffsetX: layout.anchorOffsetX,
      anchorOffsetY: layout.anchorOffsetY,
      normalizedAnchor: { x: layout.anchorX, y: layout.anchorY },
      scaleX: layout.scaleX,
      scaleY: layout.scaleY,
      rotationDeg: layout.rotationDeg,
      stagePosX: layout.stagePositionX,
      stagePosY: layout.stagePositionY,
    });
  }

  private applyScreenSpaceLayout(
    clip: CompositorClip,
    baseX: number,
    baseY: number,
    targetW: number,
    targetH: number,
  ) {
    const transform = clip.transform;
    const scaleX = typeof transform?.scale?.x === 'number' ? transform.scale.x : 1;
    const scaleY = typeof transform?.scale?.y === 'number' ? transform.scale.y : 1;
    const rotationDeg = typeof transform?.rotationDeg === 'number' ? transform.rotationDeg : 0;
    const positionX = typeof transform?.position?.x === 'number' ? transform.position.x : 0;
    const positionY = typeof transform?.position?.y === 'number' ? transform.position.y : 0;

    const stageScaleX = this.context.width / TRANSFORM_DESIGN_BASE.width;
    const stageScaleY = this.context.height / TRANSFORM_DESIGN_BASE.height;
    const stagePosX = positionX * stageScaleX;
    const stagePosY = positionY * stageScaleY;

    const normalizedAnchor = resolveNormalizedAnchor(transform?.anchor);
    const anchorOffsetX = normalizedAnchor.x * targetW;
    const anchorOffsetY = normalizedAnchor.y * targetH;

    this.applyTransformLayout({
      clip,
      baseX,
      baseY,
      targetW,
      targetH,
      anchorOffsetX,
      anchorOffsetY,
      normalizedAnchor,
      scaleX,
      scaleY,
      rotationDeg,
      stagePosX,
      stagePosY,
    });
  }

  private applyTransformLayout(input: {
    clip: CompositorClip;
    baseX: number;
    baseY: number;
    targetW: number;
    targetH: number;
    anchorOffsetX: number;
    anchorOffsetY: number;
    normalizedAnchor: { x: number; y: number };
    scaleX: number;
    scaleY: number;
    rotationDeg: number;
    stagePosX: number;
    stagePosY: number;
  }) {
    const sprite = input.clip.sprite;
    if (!sprite) return;

    sprite.anchor?.set?.(input.normalizedAnchor.x, input.normalizedAnchor.y);
    sprite.width = input.targetW;
    sprite.height = input.targetH;

    if (sprite.scale) {
      sprite.scale.x = Math.abs(sprite.scale.x) * input.scaleX;
      sprite.scale.y = Math.abs(sprite.scale.y) * input.scaleY;
    }

    sprite.rotation = (input.rotationDeg * Math.PI) / 180;
    sprite.x = input.baseX + input.anchorOffsetX + input.stagePosX;
    sprite.y = input.baseY + input.anchorOffsetY + input.stagePosY;

    const crop = input.clip.transform?.crop;
    if (crop && (crop.top || crop.bottom || crop.left || crop.right)) {
      if (!input.clip.cropMask) {
        input.clip.cropMask = new Graphics();
        if (sprite.parent) {
          sprite.parent.addChild(input.clip.cropMask);
        } else {
          sprite.addChild(input.clip.cropMask);
        }
        sprite.mask = input.clip.cropMask;
      } else if (sprite.parent && input.clip.cropMask.parent !== sprite.parent) {
        sprite.parent.addChild(input.clip.cropMask);
      }

      const mask = input.clip.cropMask as Graphics;
      mask.clear();

      const { points } = computeCropMaskPolygon({
        crop,
        targetW: input.targetW,
        targetH: input.targetH,
        anchorX: input.normalizedAnchor.x,
        anchorY: input.normalizedAnchor.y,
        scaleX: input.scaleX,
        scaleY: input.scaleY,
        rotationRad: sprite.rotation,
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
    } else if (input.clip.cropMask) {
      if (typeof input.clip.cropMask.destroy === 'function') {
        input.clip.cropMask.destroy();
      }
      input.clip.cropMask = undefined;
      sprite.mask = null;
    }
  }
}
