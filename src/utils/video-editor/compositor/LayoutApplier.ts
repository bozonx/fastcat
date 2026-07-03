import {
  computeClipBoxLayout,
  computeCropMaskPolygon,
  TRANSFORM_DESIGN_BASE,
  resolveNormalizedAnchor,
  scaleDesignPositionToScene,
} from '../clip-layout';
import { computeTextLayoutMetrics } from '../text-layout';
import type { CompositorClip } from './types';
import { Graphics } from 'pixi.js';

import { isTransformSnapSafe, snapRectToPixelGrid } from '../../pixel-grid-snap';
import { effectiveClipTransform } from './AnimationOverlay';

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
      transform: effectiveClipTransform(clip),
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
      flipHorizontal: layout.flipHorizontal,
      flipVertical: layout.flipVertical,
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
    const isSnapActive =
      Boolean(clip.snapToPixelGrid) && isTransformSnapSafe(effectiveClipTransform(clip));
    let strokeWidth = (clip.strokeWidth ?? 0) * renderScale;
    if (isSnapActive) {
      strokeWidth = Math.round(strokeWidth);
    }
    let targetW = Math.max(1, Math.ceil(size + strokeWidth * 2));
    let targetH = Math.max(1, Math.ceil(size + strokeWidth * 2));
    let baseX = (this.context.width - targetW) / 2;
    let baseY = (this.context.height - targetH) / 2;

    if (isSnapActive) {
      const snapped = snapRectToPixelGrid({ x: baseX, y: baseY, width: targetW, height: targetH });
      baseX = snapped.x;
      baseY = snapped.y;
      targetW = snapped.width;
      targetH = snapped.height;
    }

    this.applyScreenSpaceLayout(clip, baseX, baseY, targetW, targetH, isSnapActive);
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

    let w = Math.max(1, Math.ceil(layout.backgroundWidth));
    let h = Math.max(1, Math.ceil(layout.backgroundHeight));
    let baseX = layout.backgroundX;
    let baseY = layout.backgroundY;

    const isSnapActive =
      Boolean(clip.snapToPixelGrid) && isTransformSnapSafe(effectiveClipTransform(clip));
    if (isSnapActive) {
      const snapped = snapRectToPixelGrid({ x: baseX, y: baseY, width: w, height: h });
      baseX = snapped.x;
      baseY = snapped.y;
      w = snapped.width;
      h = snapped.height;
    }

    this.applyScreenSpaceLayout(clip, baseX, baseY, w, h, isSnapActive);
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

    // When WebGPU effects have padded the imageSource (blur bleed) or reframed
    // it (blur-fill), the imageSource dimensions no longer represent the content
    // size. Use the stored original dimensions so the layout doesn't shrink the
    // content to fit the padded texture.
    const frameW = clip.effectSourceW ?? Math.max(1, Math.round(clip.imageSource?.width ?? 1));
    const frameH = clip.effectSourceH ?? Math.max(1, Math.round(clip.imageSource?.height ?? 1));
    const options = clip.effectIgnoreTransform ? { ignoreClipTransform: true } : {};
    this.applySpriteLayout(frameW, frameH, clip, options);
  }

  public applySpriteLayout(
    frameW: number,
    frameH: number,
    clip: CompositorClip,
    options: { ignoreClipTransform?: boolean } = {},
  ) {
    // Blur-fill reframes the layer to fill the whole project frame, so the
    // native backend resets the layer transform (`Transform::center_fit`) and
    // maps the frame-sized result 1:1 onto the frame — ignoring the clip's
    // position/scale/crop and source orientation. Mirror that here so both
    // backends render blur-fill identically.
    const ignoreClipTransform = options.ignoreClipTransform === true;
    const clipTransform = ignoreClipTransform ? undefined : effectiveClipTransform(clip);
    const sourceRotation = ignoreClipTransform
      ? 0
      : clip.sourceOrientation && clip.sourceOrientation !== 'auto'
        ? Number(clip.sourceOrientation)
        : (clip.sourceRotation ?? 0);

    const layout = computeClipBoxLayout({
      frameWidth: frameW,
      frameHeight: frameH,
      canvasWidth: this.context.width,
      canvasHeight: this.context.height,
      fitRotationDeg: sourceRotation,
      transform: {
        ...(clipTransform ?? {}),
        rotationDeg: (clipTransform?.rotationDeg ?? 0) + sourceRotation,
      },
    });

    // The blur "bleed" path pads the effect output around the frame. The
    // ImageSource is resized before Pixi's texture internals necessarily expose
    // that new size, so derive padding from the source object we control.
    const imageSourceW = Number(clip.imageSource?.width);
    const imageSourceH = Number(clip.imageSource?.height);
    const textureW = Number.isFinite(imageSourceW) && imageSourceW > 0 ? imageSourceW : frameW;
    const textureH = Number.isFinite(imageSourceH) && imageSourceH > 0 ? imageSourceH : frameH;
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
      disableCrop: ignoreClipTransform,
      flipHorizontal: layout.flipHorizontal,
      flipVertical: layout.flipVertical,
    });
  }

  private applyScreenSpaceLayout(
    clip: CompositorClip,
    baseX: number,
    baseY: number,
    targetW: number,
    targetH: number,
    isSnapActive: boolean,
  ) {
    const transform = effectiveClipTransform(clip);
    const scaleX = typeof transform?.scale?.x === 'number' ? transform.scale.x : 1;
    const scaleY = typeof transform?.scale?.y === 'number' ? transform.scale.y : 1;
    const rotationDeg = typeof transform?.rotationDeg === 'number' ? transform.rotationDeg : 0;
    const flipHorizontal = Boolean(transform?.flipHorizontal);
    const flipVertical = Boolean(transform?.flipVertical);

    const { x: stagePosX, y: stagePosY } = scaleDesignPositionToScene(
      transform?.position,
      this.context.width,
      this.context.height,
    );

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
      flipHorizontal,
      flipVertical,
      isSnapActive,
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
    disableCrop?: boolean;
    flipHorizontal?: boolean;
    flipVertical?: boolean;
    isSnapActive?: boolean;
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

    const targetDisplayW = paddedW * fitScaleX;
    const targetDisplayH = paddedH * fitScaleY;
    const textureSize = this.getSpriteTextureSize(sprite);

    const flipHorizontal = Boolean(input.flipHorizontal);
    const flipVertical = Boolean(input.flipVertical);

    const finalScaleX = flipHorizontal ? -input.scaleX : input.scaleX;
    const finalScaleY = flipVertical ? -input.scaleY : input.scaleY;

    if (sprite.scale && textureSize) {
      sprite.scale.x = (targetDisplayW / textureSize.width) * finalScaleX;
      sprite.scale.y = (targetDisplayH / textureSize.height) * finalScaleY;
    } else {
      if (sprite.scale) {
        sprite.scale.x = Math.abs(sprite.scale.x);
        sprite.scale.y = Math.abs(sprite.scale.y);
      }

      sprite.width = targetDisplayW;
      sprite.height = targetDisplayH;

      if (sprite.scale) {
        sprite.scale.x *= finalScaleX;
        sprite.scale.y *= finalScaleY;
      }
    }

    sprite.rotation = (input.rotationDeg * Math.PI) / 180;

    // Compensation for flipping around the geometric center instead of the anchor point
    const flipOffsetX = flipHorizontal ? 2 * (0.5 - anchorX) * targetDisplayW * input.scaleX : 0;
    const flipOffsetY = flipVertical ? 2 * (0.5 - anchorY) * targetDisplayH * input.scaleY : 0;

    sprite.x = input.baseX + input.anchorOffsetX + input.stagePosX + flipOffsetX;
    sprite.y = input.baseY + input.anchorOffsetY + input.stagePosY + flipOffsetY;

    if (input.isSnapActive) {
      // Snap the sprite's LOCAL ORIGIN (its on-screen top-left) to the pixel grid,
      // NOT its anchor position. Pixi pins the anchor point (`anchorX * displayW`
      // into the sprite) to `sprite.x`, so the on-screen top-left is
      // `sprite.x - anchorX * displayW`. With a centered anchor (0.5) and an ODD
      // display width, rounding `sprite.x` directly would leave that top-left on a
      // half pixel — and the text canvas bitmap (whose border + glyphs are already
      // rasterized crisply at integer LOCAL coords in TextRenderer, with the 0.5px
      // stroke centerline) then gets RESAMPLED into soft edges. Rounding the origin
      // and re-deriving `sprite.x` keeps the bitmap 1:1 on the device grid.
      //
      // This is the web mirror of the native compositor's `finalize_layer` origin
      // rounding (src-tauri/src/monitor/scene/build/layer_builder.rs). Do NOT change
      // this back to `Math.round(sprite.x)` — that reintroduces the odd-width blur.
      // Exact only when the Pixi backing resolution equals the project resolution
      // (export + a 1/1 monitor); a scaled/CSS-stretched preview cannot align to
      // physical pixels regardless of this rounding.
      const originX = sprite.x - anchorX * targetDisplayW;
      const originY = sprite.y - anchorY * targetDisplayH;
      sprite.x += Math.round(originX) - originX;
      sprite.y += Math.round(originY) - originY;
    }

    const crop = !input.disableCrop ? effectiveClipTransform(input.clip)?.crop : undefined;
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
        flipHorizontal ? '1' : '0',
        flipVertical ? '1' : '0',
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
          flipHorizontal,
          flipVertical,
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

  private getSpriteTextureSize(
    sprite: CompositorClip['sprite'],
  ): { width: number; height: number } | null {
    const texture = (sprite as { texture?: { orig?: { width?: number; height?: number } } } | null)
      ?.texture;
    const width = Number(texture?.orig?.width);
    const height = Number(texture?.orig?.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return null;
    }
    return { width, height };
  }
}
