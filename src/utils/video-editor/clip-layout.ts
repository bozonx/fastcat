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
}

function clampFinite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
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
  } = params;

  const rawT = (Math.max(0, Math.min(100, crop.top ?? 0)) / 100) * targetH;
  const rawB = (Math.max(0, Math.min(100, crop.bottom ?? 0)) / 100) * targetH;
  const rawL = (Math.max(0, Math.min(100, crop.left ?? 0)) / 100) * targetW;
  const rawR = (Math.max(0, Math.min(100, crop.right ?? 0)) / 100) * targetW;

  // Clamp opposing edges so they don't overlap (prevents degenerate polygon)
  const t = rawT;
  const b = Math.min(rawB, Math.max(0, targetH - rawT));
  const l = rawL;
  const r = Math.min(rawR, Math.max(0, targetW - rawL));

  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);

  const toWorldX = (px: number, py: number) => {
    const dx = (px - ax * targetW) * sx;
    const dy = (py - ay * targetH) * sy;
    return spritePosX + dx * cosR - dy * sinR;
  };
  const toWorldY = (px: number, py: number) => {
    const dx = (px - ax * targetW) * sx;
    const dy = (py - ay * targetH) * sy;
    return spritePosY + dx * sinR + dy * cosR;
  };

  return {
    points: [
      toWorldX(l, t),
      toWorldY(l, t),
      toWorldX(targetW - r, t),
      toWorldY(targetW - r, t),
      toWorldX(targetW - r, targetH - b),
      toWorldY(targetW - r, targetH - b),
      toWorldX(l, targetH - b),
      toWorldY(l, targetH - b),
    ],
  };
}

export function computeClipBoxLayout(input: ClipBoxLayoutInput): ClipBoxLayout {
  const safeFrameWidth = Math.max(1, input.frameWidth);
  const safeFrameHeight = Math.max(1, input.frameHeight);
  const safeCanvasWidth = Math.max(1, input.canvasWidth);
  const safeCanvasHeight = Math.max(1, input.canvasHeight);

  const viewportScale = Math.min(
    safeCanvasWidth / safeFrameWidth,
    safeCanvasHeight / safeFrameHeight,
  );
  const targetWidth = safeFrameWidth * viewportScale;
  const targetHeight = safeFrameHeight * viewportScale;
  const baseX = (safeCanvasWidth - targetWidth) / 2;
  const baseY = (safeCanvasHeight - targetHeight) / 2;

  const transform = input.transform;
  const scaleX = clampFinite(transform?.scale?.x, 1);
  const scaleY = clampFinite(transform?.scale?.y, 1);
  const rotationDeg = clampFinite(transform?.rotationDeg, 0);
  const positionX = clampFinite(transform?.position?.x, 0);
  const positionY = clampFinite(transform?.position?.y, 0);

  const normalizedAnchor = resolveNormalizedAnchor(transform?.anchor);
  const anchorOffsetX = normalizedAnchor.x * targetWidth;
  const anchorOffsetY = normalizedAnchor.y * targetHeight;
  const stageScaleX = safeCanvasWidth / TRANSFORM_DESIGN_BASE.width;
  const stageScaleY = safeCanvasHeight / TRANSFORM_DESIGN_BASE.height;
  const stagePositionX = positionX * stageScaleX;
  const stagePositionY = positionY * stageScaleY;

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
  };
}
