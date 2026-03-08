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
