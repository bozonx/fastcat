import type { ClipAnchor, ClipTransform } from '~/timeline/types';

export const TRANSFORM_DESIGN_BASE = {
  width: 1920,
  height: 1080,
} as const;

export interface ClipBoxLayoutInput {
  frameWidth: number;
  frameHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  transform?: ClipTransform;
  fitRotationDeg?: number;
}

export interface ClipBoxLayout {
  baseX: number;
  baseY: number;
  targetWidth: number;
  targetHeight: number;
  anchorX: number;
  anchorY: number;
  anchorOffsetX: number;
  anchorOffsetY: number;
  positionX: number;
  positionY: number;
  stagePositionX: number;
  stagePositionY: number;
  scaleX: number;
  scaleY: number;
  rotationDeg: number;
  flipHorizontal: boolean;
  flipVertical: boolean;
}

function clampFinite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isQuarterTurn(rotationDeg: number): boolean {
  const normalized = ((Math.round(rotationDeg) % 360) + 360) % 360;
  return normalized === 90 || normalized === 270;
}

export function resolveNormalizedAnchor(anchor?: ClipAnchor): { x: number; y: number } {
  const preset = typeof anchor?.preset === 'string' ? anchor.preset : 'center';

  switch (preset) {
    case 'topLeft':
      return { x: 0, y: 0 };
    case 'topRight':
      return { x: 1, y: 0 };
    case 'bottomLeft':
      return { x: 0, y: 1 };
    case 'bottomRight':
      return { x: 1, y: 1 };
    case 'custom':
      return {
        x: clampFinite(anchor?.x, 0.5),
        y: clampFinite(anchor?.y, 0.5),
      };
    case 'center':
    default:
      return { x: 0.5, y: 0.5 };
  }
}

/**
 * Scale a design-space (1920x1080 base) position offset to the render/scene
 * resolution, per-axis. This is the single source for the design→scene position
 * mapping shared by the web compositor (`computeClipBoxLayout` /
 * `LayoutApplier.applyScreenSpaceLayout`) and the native monitor scene builder
 * (`buildNative*Transform`). Keeping it in one place stops the two engines from
 * drifting on non-16:9 outputs. Non-finite components fall back to 0.
 */
export function scaleDesignPositionToScene(
  position: { x?: number; y?: number } | undefined,
  sceneWidth: number,
  sceneHeight: number,
): { x: number; y: number } {
  return {
    x: clampFinite(position?.x, 0) * (sceneWidth / TRANSFORM_DESIGN_BASE.width),
    y: clampFinite(position?.y, 0) * (sceneHeight / TRANSFORM_DESIGN_BASE.height),
  };
}

export interface CropInsetRect {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

/**
 * Visible crop rectangle in the layer's local space, from the four crop
 * percentages (0..100 each) and the local box size.
 *
 * Cross-engine parity contract: the native compositor computes the same inset
 * rectangle in `Transform::crop_inset_rect` (src-tauri/src/compositor/scene.rs).
 * Both agree for non-overlapping crops (the region pinned by
 * `shared/parity/crop-inset-rect.cases.json`).
 *
 * KNOWN INTENTIONAL DIVERGENCE when opposing crops overlap (left+right > 100% or
 * top+bottom > 100%): this engine keeps the first edge and clamps the second to
 * the remaining space, whereas the native engine scales BOTH opposing edges down
 * proportionally. This degenerate case is excluded from the shared fixture.
 */
export function computeCropInsetRect(
  width: number,
  height: number,
  crop: { top?: number; bottom?: number; left?: number; right?: number },
): CropInsetRect {
  const rawT = (Math.max(0, Math.min(100, crop.top ?? 0)) / 100) * height;
  const rawB = (Math.max(0, Math.min(100, crop.bottom ?? 0)) / 100) * height;
  const rawL = (Math.max(0, Math.min(100, crop.left ?? 0)) / 100) * width;
  const rawR = (Math.max(0, Math.min(100, crop.right ?? 0)) / 100) * width;

  const t = rawT;
  const b = Math.min(rawB, Math.max(0, height - rawT));
  const l = rawL;
  const r = Math.min(rawR, Math.max(0, width - rawL));

  return { xMin: l, yMin: t, xMax: width - r, yMax: height - b };
}

export interface CropMaskPolygon {
  /** Flat array of 8 world-space coordinates: [x0,y0, x1,y1, x2,y2, x3,y3] (TL, TR, BR, BL) */
  points: [number, number, number, number, number, number, number, number];
}

/**
 * Computes the 4 world-space corners of the visible crop region for a sprite.
 *
 * Formula: display-space point (px, py) → world space:
 *   dx = (px - ax·targetW) · scaleX
 *   dy = (py - ay·targetH) · scaleY
 *   worldX = spritePosX + dx·cos(rot) − dy·sin(rot)
 *   worldY = spritePosY + dx·sin(rot) + dy·cos(rot)
 */
export function computeCropMaskPolygon(params: {
  /** Crop percentages (0..100 each) */
  crop: { top?: number; bottom?: number; left?: number; right?: number };
  targetW: number;
  targetH: number;
  /** Normalized anchor (0..1) */
  anchorX: number;
  anchorY: number;
  /** User-defined scale (can be negative for flip) */
  scaleX: number;
  scaleY: number;
  rotationRad: number;
  /** World-space position of the anchor point (sprite.x, sprite.y) */
  spritePosX: number;
  spritePosY: number;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
}): CropMaskPolygon {
  const {
    crop,
    targetW,
    targetH,
    anchorX: ax,
    anchorY: ay,
    scaleX: sx,
    scaleY: sy,
    rotationRad: rot,
    spritePosX,
    spritePosY,
    flipHorizontal = false,
    flipVertical = false,
  } = params;

  // Visible inset rect in local space (shared with the native engine).
  const {
    xMin: l,
    yMin: t,
    xMax: rightEdge,
    yMax: bottomEdge,
  } = computeCropInsetRect(targetW, targetH, crop);

  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);

  const toWorldX = (px: number, py: number) => {
    const flippedX = flipHorizontal ? targetW - px : px;
    const flippedY = flipVertical ? targetH - py : py;
    const dx = (flippedX - ax * targetW) * sx;
    const dy = (flippedY - ay * targetH) * sy;
    return spritePosX + dx * cosR - dy * sinR;
  };
  const toWorldY = (px: number, py: number) => {
    const flippedX = flipHorizontal ? targetW - px : px;
    const flippedY = flipVertical ? targetH - py : py;
    const dx = (flippedX - ax * targetW) * sx;
    const dy = (flippedY - ay * targetH) * sy;
    return spritePosY + dx * sinR + dy * cosR;
  };

  return {
    points: [
      toWorldX(l, t),
      toWorldY(l, t),
      toWorldX(rightEdge, t),
      toWorldY(rightEdge, t),
      toWorldX(rightEdge, bottomEdge),
      toWorldY(rightEdge, bottomEdge),
      toWorldX(l, bottomEdge),
      toWorldY(l, bottomEdge),
    ],
  };
}

export interface ContainFit {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Aspect-preserving "contain" fit of a `natural` box into a `viewport`, centered
 * (letterbox/pillarbox). Returns the uniform scale and the top-left offset.
 *
 * Cross-engine parity contract: the native engine computes the same fit in
 * `fit_into` (src-tauri/src/compositor/scene.rs), pinned by
 * `shared/parity/contain-fit.cases.json`. `orientedFitScale` adds the quarter-turn
 * swap on top of this (mirrors native `oriented_fit_scale`).
 */
export function computeContainFit(
  naturalWidth: number,
  naturalHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): ContainFit {
  const nw = Math.max(1, naturalWidth);
  const nh = Math.max(1, naturalHeight);
  const vw = Math.max(1, viewportWidth);
  const vh = Math.max(1, viewportHeight);
  const scale = Math.min(vw / nw, vh / nh);
  return {
    scale,
    offsetX: (vw - nw * scale) / 2,
    offsetY: (vh - nh * scale) / 2,
  };
}

/**
 * Uniform "contain" fit scale that accounts for a quarter-turn source rotation
 * (the rotated box is fitted, so a 90°/270° clip fills the frame correctly).
 * Mirrors native `oriented_fit_scale`.
 */
export function orientedFitScale(
  naturalWidth: number,
  naturalHeight: number,
  sceneWidth: number,
  sceneHeight: number,
  rotationDeg: number,
): number {
  const fitW = isQuarterTurn(rotationDeg) ? naturalHeight : naturalWidth;
  const fitH = isQuarterTurn(rotationDeg) ? naturalWidth : naturalHeight;
  return computeContainFit(fitW, fitH, sceneWidth, sceneHeight).scale;
}

export function computeClipBoxLayout(input: ClipBoxLayoutInput): ClipBoxLayout {
  const safeFrameWidth = Math.max(1, input.frameWidth);
  const safeFrameHeight = Math.max(1, input.frameHeight);
  const safeCanvasWidth = Math.max(1, input.canvasWidth);
  const safeCanvasHeight = Math.max(1, input.canvasHeight);

  const fitRotation = clampFinite(input.fitRotationDeg, 0);
  const fitScale = orientedFitScale(
    safeFrameWidth,
    safeFrameHeight,
    safeCanvasWidth,
    safeCanvasHeight,
    fitRotation,
  );
  const isQuarter = isQuarterTurn(fitRotation);
  const orientedW = isQuarter ? safeFrameHeight : safeFrameWidth;
  const orientedH = isQuarter ? safeFrameWidth : safeFrameHeight;

  const targetWidth = orientedW * fitScale;
  const targetHeight = orientedH * fitScale;
  const baseX = (safeCanvasWidth - targetWidth) / 2;
  const baseY = (safeCanvasHeight - targetHeight) / 2;

  const transform = input.transform;
  const scaleX = clampFinite(transform?.scale?.x, 1);
  const scaleY = clampFinite(transform?.scale?.y, 1);
  const rotationDeg = clampFinite(transform?.rotationDeg, 0);
  const positionX = clampFinite(transform?.position?.x, 0);
  const positionY = clampFinite(transform?.position?.y, 0);
  const flipHorizontal = Boolean(transform?.flipHorizontal);
  const flipVertical = Boolean(transform?.flipVertical);

  const normalizedAnchor = resolveNormalizedAnchor(transform?.anchor);
  const anchorOffsetX = normalizedAnchor.x * targetWidth;
  const anchorOffsetY = normalizedAnchor.y * targetHeight;
  const { x: stagePositionX, y: stagePositionY } = scaleDesignPositionToScene(
    { x: positionX, y: positionY },
    safeCanvasWidth,
    safeCanvasHeight,
  );

  return {
    baseX,
    baseY,
    targetWidth,
    targetHeight,
    anchorX: normalizedAnchor.x,
    anchorY: normalizedAnchor.y,
    anchorOffsetX,
    anchorOffsetY,
    positionX,
    positionY,
    stagePositionX,
    stagePositionY,
    scaleX,
    scaleY,
    rotationDeg,
    flipHorizontal,
    flipVertical,
  };
}
