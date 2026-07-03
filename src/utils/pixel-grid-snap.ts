import type { ClipTransform } from '~/timeline/types';

export interface SnapRectOptions {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SnappedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SnapStrokeOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  borderWidth: number;
}

export interface SnappedStroke {
  borderWidth: number;
  strokeX: number;
  strokeY: number;
  strokeWidth: number;
  strokeHeight: number;
  offset: number;
}

export interface SnapTextOriginOptions {
  x: number;
  y: number;
}

export interface SnappedTextOrigin {
  x: number;
  y: number;
}

/**
 * Checks whether a clip transform is axis-aligned, unscaled (scale ~ 1),
 * and not rotated, making it safe to snap to pixel grid without frame jitter.
 */
export function isTransformSnapSafe(transform?: ClipTransform): boolean {
  if (!transform) return true;

  const rot = transform.rotationDeg ?? 0;
  const rotNorm = Math.abs(rot % 360);
  const isRotationAxisAligned = rotNorm < 1e-4 || Math.abs(rotNorm - 360) < 1e-4;
  if (!isRotationAxisAligned) return false;

  const scaleX = transform.scale?.x ?? 1;
  const scaleY = transform.scale?.y ?? 1;
  const isScaleUnit = Math.abs(scaleX - 1) < 1e-4 && Math.abs(scaleY - 1) < 1e-4;
  if (!isScaleUnit) return false;

  return true;
}

/**
 * Snaps rectangular background or shape bounds to nearest integer pixels.
 * Does not mutate original values.
 */
export function snapRectToPixelGrid(rect: SnapRectOptions): SnappedRect {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

/**
 * Snaps stroke width and stroke position/dimensions to pixel grid.
 * Rules:
 *   borderWidth = round(borderWidth)
 *   offset = borderWidth % 2 === 1 ? 0.5 : 0
 *   strokeX = round(x) + offset
 *   strokeY = round(y) + offset
 *   strokeWidth = round(width)
 *   strokeHeight = round(height)
 */
export function snapStrokeToPixelGrid(options: SnapStrokeOptions): SnappedStroke {
  const borderWidth = Math.round(options.borderWidth);
  const offset = borderWidth % 2 === 1 ? 0.5 : 0;
  const strokeX = Math.round(options.x) + offset;
  const strokeY = Math.round(options.y) + offset;
  const strokeWidth = Math.round(options.width);
  const strokeHeight = Math.round(options.height);

  return {
    borderWidth,
    offset,
    strokeX,
    strokeY,
    strokeWidth,
    strokeHeight,
  };
}

/**
 * Snaps text origin (x, y) to integer pixels before rendering.
 * Does not touch individual glyph coordinates or kerning.
 */
export function snapTextOriginToPixelGrid(origin: SnapTextOriginOptions): SnappedTextOrigin {
  return {
    x: Math.round(origin.x),
    y: Math.round(origin.y),
  };
}
