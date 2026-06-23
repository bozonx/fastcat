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
  designWidth?: number;
  designHeight?: number;
}

export class LayoutApplier {
  constructor(private readonly context: LayoutApplierContext) {}

  public applySolidLayout(clip: CompositorClip) {
    const layout = computeClipBoxLayout({
      frameWidth: this.context.width,
      frameHeight: this.context.height,
      canvasWidth: this.context.width,
      canvasHeight: this.context.height,
      transform: clip.transformActive !== false ? clip.transform : undefined,
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
    // Stroke width is design-space (1920x1080) and scaled uniformly to the render
    // resolution. Must match `ShapeRenderer` (which draws the graphics) so the
    // sprite box, anchor offset and crop mask line up with the painted outline.
    const renderScale = Math.min(
      this.context.width / TRANSFORM_DESIGN_BASE.width,
      this.context.height / TRANSFORM_DESIGN_BASE.height,
    );
    const strokeWidth = (clip.strokeWidth ?? 0) * renderScale;
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
      designWidth: this.context.designWidth ?? this.context.width,
      designHeight: this.context.designHeight ?? this.context.height,
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
    const sourceRotation =
      clip.sourceOrientation && clip.sourceOrientation !== 'auto'
        ? Number(clip.sourceOrientation)
        : (clip.sourceRotation ?? 0);

    const layout = computeClipBoxLayout({
      frameWidth: frameW,
      frameHeight: frameH,
      canvasWidth: this.context.width,
      canvasHeight: this.context.height,
      fitRotationDeg: sourceRotation,
      transform: {
        ...((clip.transformActive !== false ? clip.transform : undefined) ?? {}),
        rotationDeg:
          ((clip.transformActive !== false ? clip.transform : undefined)?.rotationDeg ?? 0) +
          sourceRotation,
      },
    });

    // The blur "bleed" path pads the effect output around the frame, so the
    // sprite texture can be larger than frameW×frameH; derive that padding from
    // the actual texture source size. `texture.source` isn't on Pixi's narrowed
    // sprite type here, so read it through a loose cast.
    const textureSource = (
      clip.sprite as { texture?: { source?: { width?: number; height?: number } } } | undefined
    )?.texture?.source;
    const textureW = textureSource?.width ?? frameW;
    const textureH = textureSource?.height ?? frameH;
    const paddingX = Math.max(0, Math.round((textureW - frameW) / 2));
    const paddingY = Math.max(0, Math.round((textureH - frameH) / 2));

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
      paddingX,
      paddingY,
      frameW,
      frameH,
    });
  }

  private applyScreenSpaceLayout(
    clip: CompositorClip,
    baseX: number,
    baseY: number,
    targetW: number,
    targetH: number,
  ) {
    const transform = clip.transformActive !== false ? clip.transform : undefined;
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
    paddingX?: number;
    paddingY?: number;
    frameW?: number;
    frameH?: number;
  }) {
    const sprite = input.clip.sprite;
    if (!sprite) return;

    const padX = input.paddingX ?? 0;
    const padY = input.paddingY ?? 0;
    const fW = input.frameW ?? input.targetW;
    const fH = input.frameH ?? input.targetH;

    const paddedW = fW + 2 * padX;
    const paddedH = fH + 2 * padY;

    const fitScaleX = input.targetW / fW;
    const fitScaleY = input.targetH / fH;

    const anchorX =
      paddedW > 0 ? (input.normalizedAnchor.x * fW + padX) / paddedW : input.normalizedAnchor.x;
    const anchorY =
      paddedH > 0 ? (input.normalizedAnchor.y * fH + padY) / paddedH : input.normalizedAnchor.y;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sprite as any).anchor?.set?.(anchorX, anchorY);

    if (sprite.scale) {
      sprite.scale.x = Math.abs(sprite.scale.x);
      sprite.scale.y = Math.abs(sprite.scale.y);
    }

    sprite.width = paddedW * fitScaleX;
    sprite.height = paddedH * fitScaleY;

    if (sprite.scale) {
      sprite.scale.x *= Math.sign(input.scaleX);
      sprite.scale.y *= Math.sign(input.scaleY);
    }

    sprite.rotation = (input.rotationDeg * Math.PI) / 180;
    sprite.x = input.baseX + input.anchorOffsetX + input.stagePosX;
    sprite.y = input.baseY + input.anchorOffsetY + input.stagePosY;

    const crop = input.clip.transformActive !== false ? input.clip.transform?.crop : undefined;
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
        input.clip.cropMaskKey = undefined;
      }

      // Crop polygon is fully determined by these inputs. Skip the
      // clear+poly+fill rebuild when nothing relevant has changed.
      const cropKey = [
        crop.top ?? 0,
        crop.bottom ?? 0,
        crop.left ?? 0,
        crop.right ?? 0,
        input.targetW,
        input.targetH,
        input.normalizedAnchor.x,
        input.normalizedAnchor.y,
        input.scaleX,
        input.scaleY,
        sprite.rotation,
        sprite.x,
        sprite.y,
      ].join('|');

      if (input.clip.cropMaskKey !== cropKey) {
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
        input.clip.cropMaskKey = cropKey;
      }
    } else if (input.clip.cropMask) {
      if (typeof input.clip.cropMask.destroy === 'function') {
        input.clip.cropMask.destroy();
      }
      input.clip.cropMask = undefined;
      input.clip.cropMaskKey = undefined;
      sprite.mask = null;
    }
  }
}
