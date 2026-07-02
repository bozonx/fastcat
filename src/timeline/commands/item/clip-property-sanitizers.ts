import type {
  TimelineBlendMode,
  ClipTransform,
  ClipAnchorPreset,
  ClipSourceOrientation,
} from '../../types';
import { isTimelineBlendMode } from '~/utils/constants';

// Pure value sanitizers for `updateClipProperties`. They never read clip/doc
// state — each takes a raw (untrusted) value and returns a normalized one or
// `undefined` when the caller should drop the property entirely.

export function clampNumber(value: unknown, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.max(min, Math.min(max, n));
}

export function sanitizeBlendMode(value: unknown): TimelineBlendMode | undefined {
  return isTimelineBlendMode(value) ? value : undefined;
}

export function sanitizeSourceOrientation(value: unknown): ClipSourceOrientation | undefined {
  return value === 'auto' || value === '0' || value === '90' || value === '180' || value === '270'
    ? value
    : undefined;
}

export function clampAudioFadeUs(value: unknown, maxUs: number): number | undefined {
  if (value === undefined) return undefined;
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0;
  return clampNumber(n, 0, Math.max(0, Math.round(maxUs)));
}

export function sanitizeTransform(raw: unknown): ClipTransform | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const rawRecord = raw as Record<string, unknown>;

  const scaleRaw = rawRecord['scale'];
  const scale =
    scaleRaw && typeof scaleRaw === 'object'
      ? {
          x: clampNumber((scaleRaw as Record<string, unknown>)['x'], -1000, 1000),
          y: clampNumber((scaleRaw as Record<string, unknown>)['y'], -1000, 1000),
          linked:
            (scaleRaw as Record<string, unknown>)['linked'] !== undefined
              ? Boolean((scaleRaw as Record<string, unknown>)['linked'])
              : undefined,
        }
      : undefined;

  const rotationDegRaw = rawRecord['rotationDeg'];
  const rotationDeg =
    typeof rotationDegRaw === 'number' && Number.isFinite(rotationDegRaw)
      ? Math.max(-36000, Math.min(36000, rotationDegRaw))
      : undefined;

  const positionRaw = rawRecord['position'];
  const position =
    positionRaw && typeof positionRaw === 'object'
      ? {
          x: clampNumber((positionRaw as Record<string, unknown>)['x'], -1_000_000, 1_000_000),
          y: clampNumber((positionRaw as Record<string, unknown>)['y'], -1_000_000, 1_000_000),
        }
      : undefined;

  const anchorRaw = rawRecord['anchor'];
  const preset =
    anchorRaw && typeof anchorRaw === 'object'
      ? String((anchorRaw as Record<string, unknown>)['preset'] ?? '')
      : '';
  const safePreset =
    preset === 'center' ||
    preset === 'topLeft' ||
    preset === 'topRight' ||
    preset === 'bottomLeft' ||
    preset === 'bottomRight' ||
    preset === 'custom'
      ? (preset as ClipAnchorPreset)
      : undefined;
  const anchor =
    safePreset !== undefined
      ? {
          preset: safePreset,
          x:
            safePreset === 'custom'
              ? clampNumber((anchorRaw as Record<string, unknown>)['x'], -10, 10)
              : undefined,
          y:
            safePreset === 'custom'
              ? clampNumber((anchorRaw as Record<string, unknown>)['y'], -10, 10)
              : undefined,
        }
      : undefined;

  const cropRaw = rawRecord['crop'];
  const crop =
    cropRaw && typeof cropRaw === 'object'
      ? {
          top: clampNumber((cropRaw as Record<string, unknown>)['top'] ?? 0, 0, 100),
          bottom: clampNumber((cropRaw as Record<string, unknown>)['bottom'] ?? 0, 0, 100),
          left: clampNumber((cropRaw as Record<string, unknown>)['left'] ?? 0, 0, 100),
          right: clampNumber((cropRaw as Record<string, unknown>)['right'] ?? 0, 0, 100),
        }
      : undefined;

  const hasFlipHorizontal = Object.prototype.hasOwnProperty.call(rawRecord, 'flipHorizontal');
  const hasFlipVertical = Object.prototype.hasOwnProperty.call(rawRecord, 'flipVertical');
  const flipHorizontal = hasFlipHorizontal ? Boolean(rawRecord['flipHorizontal']) : undefined;
  const flipVertical = hasFlipVertical ? Boolean(rawRecord['flipVertical']) : undefined;

  if (
    !scale &&
    rotationDeg === undefined &&
    !position &&
    !anchor &&
    !crop &&
    !hasFlipHorizontal &&
    !hasFlipVertical
  ) {
    return undefined;
  }

  return {
    scale,
    rotationDeg,
    position,
    anchor,
    crop,
    flipHorizontal,
    flipVertical,
  };
}

// Sanitizes a text clip's `style` object. Returns the cleaned style, or
// `undefined` when the input is not an object or no valid field survives — in
// both cases the caller drops the `style` property.
export function sanitizeTextStyle(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const rawRecord = raw as Record<string, unknown>;

  const fontFamily = typeof rawRecord.fontFamily === 'string' ? rawRecord.fontFamily : undefined;
  const widthRaw = rawRecord.width;
  const hasWidth = 'width' in rawRecord;
  const width =
    typeof widthRaw === 'number' && Number.isFinite(widthRaw) && widthRaw > 0
      ? Math.max(1, Math.min(10_000, Math.round(widthRaw)))
      : undefined;
  const heightRaw = rawRecord.height;
  const hasHeight = 'height' in rawRecord;
  const height =
    typeof heightRaw === 'number' && Number.isFinite(heightRaw) && heightRaw > 0
      ? Math.max(1, Math.min(10_000, Math.round(heightRaw)))
      : undefined;
  const fontSizeRaw = rawRecord.fontSize;
  const fontSize =
    typeof fontSizeRaw === 'number' && Number.isFinite(fontSizeRaw)
      ? Math.max(1, Math.min(1000, Math.round(fontSizeRaw)))
      : undefined;
  const fontWeight =
    typeof rawRecord.fontWeight === 'string' || typeof rawRecord.fontWeight === 'number'
      ? rawRecord.fontWeight
      : undefined;
  const color = typeof rawRecord.color === 'string' ? rawRecord.color : undefined;
  const clampAlpha = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0, Math.min(1, value))
      : undefined;
  const clampRange = (value: unknown, min: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.max(min, Math.min(max, value))
      : undefined;
  const colorAlpha = clampAlpha(rawRecord.colorAlpha);
  const textShadowEnabled =
    typeof rawRecord.textShadowEnabled === 'boolean' ? rawRecord.textShadowEnabled : undefined;
  const textShadowColor =
    typeof rawRecord.textShadowColor === 'string' ? rawRecord.textShadowColor.trim() : undefined;
  const textShadowAlpha = clampAlpha(rawRecord.textShadowAlpha);
  const textShadowBlur = clampRange(rawRecord.textShadowBlur, 0, 10_000);
  const textShadowSpread = clampRange(rawRecord.textShadowSpread, 0, 10_000);
  const textShadowOffsetX = clampRange(rawRecord.textShadowOffsetX, -10_000, 10_000);
  const textShadowOffsetY = clampRange(rawRecord.textShadowOffsetY, -10_000, 10_000);
  const alignRaw = rawRecord.align;
  const align =
    alignRaw === 'left' || alignRaw === 'center' || alignRaw === 'right' ? alignRaw : undefined;

  const verticalAlignRaw = rawRecord.verticalAlign;
  const verticalAlign =
    verticalAlignRaw === 'top' || verticalAlignRaw === 'middle' || verticalAlignRaw === 'bottom'
      ? verticalAlignRaw
      : undefined;

  const lineHeightRaw = rawRecord.lineHeight;
  const lineHeight =
    typeof lineHeightRaw === 'number' && Number.isFinite(lineHeightRaw)
      ? Math.max(0.1, Math.min(10, lineHeightRaw))
      : undefined;

  const letterSpacingRaw = rawRecord.letterSpacing;
  const letterSpacing =
    typeof letterSpacingRaw === 'number' && Number.isFinite(letterSpacingRaw)
      ? Math.max(-1000, Math.min(1000, letterSpacingRaw))
      : undefined;

  const backgroundColor =
    typeof rawRecord.backgroundColor === 'string' ? rawRecord.backgroundColor.trim() : undefined;
  const backgroundEnabled =
    typeof rawRecord.backgroundEnabled === 'boolean' ? rawRecord.backgroundEnabled : undefined;
  const backgroundAlpha = clampAlpha(rawRecord.backgroundAlpha);
  const backgroundRadiusRaw = rawRecord.backgroundRadius;
  const backgroundRadius =
    typeof backgroundRadiusRaw === 'number' && Number.isFinite(backgroundRadiusRaw)
      ? Math.max(0, Math.min(10_000, backgroundRadiusRaw))
      : undefined;
  const backgroundShadowEnabled =
    typeof rawRecord.backgroundShadowEnabled === 'boolean'
      ? rawRecord.backgroundShadowEnabled
      : undefined;
  const backgroundShadowColor =
    typeof rawRecord.backgroundShadowColor === 'string'
      ? rawRecord.backgroundShadowColor.trim()
      : undefined;
  const backgroundShadowAlpha = clampAlpha(rawRecord.backgroundShadowAlpha);
  const backgroundShadowBlur = clampRange(rawRecord.backgroundShadowBlur, 0, 10_000);
  const backgroundShadowSpread = clampRange(rawRecord.backgroundShadowSpread, 0, 10_000);
  const backgroundShadowOffsetX = clampRange(rawRecord.backgroundShadowOffsetX, -10_000, 10_000);
  const backgroundShadowOffsetY = clampRange(rawRecord.backgroundShadowOffsetY, -10_000, 10_000);
  const borderEnabled =
    typeof rawRecord.borderEnabled === 'boolean' ? rawRecord.borderEnabled : undefined;
  const borderColor =
    typeof rawRecord.borderColor === 'string' ? rawRecord.borderColor.trim() : undefined;
  const borderAlpha = clampAlpha(rawRecord.borderAlpha);
  const borderWidthRaw = rawRecord.borderWidth;
  const borderWidth =
    typeof borderWidthRaw === 'number' && Number.isFinite(borderWidthRaw)
      ? Math.max(0, Math.min(10_000, borderWidthRaw))
      : undefined;
  const paddingLinked =
    typeof rawRecord.paddingLinked === 'boolean' ? rawRecord.paddingLinked : undefined;

  const paddingRaw = rawRecord.padding;
  const padding = (() => {
    const clampPadding = (v: unknown) =>
      typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(10_000, v)) : undefined;

    if (typeof paddingRaw === 'number') {
      const v = clampPadding(paddingRaw);
      return v === undefined ? undefined : { top: v, right: v, bottom: v, left: v };
    }
    if (!paddingRaw || typeof paddingRaw !== 'object') return undefined;

    const padRecord = paddingRaw as Record<string, unknown>;
    const x = clampPadding(padRecord.x);
    const y = clampPadding(padRecord.y);
    const top = clampPadding(padRecord.top);
    const right = clampPadding(padRecord.right);
    const bottom = clampPadding(padRecord.bottom);
    const left = clampPadding(padRecord.left);

    const fromXY =
      x !== undefined || y !== undefined
        ? {
            top: y ?? 0,
            right: x ?? 0,
            bottom: y ?? 0,
            left: x ?? 0,
          }
        : undefined;
    const fromEdges =
      top !== undefined || right !== undefined || bottom !== undefined || left !== undefined
        ? {
            top: top ?? 0,
            right: right ?? 0,
            bottom: bottom ?? 0,
            left: left ?? 0,
          }
        : undefined;

    const resolved = fromEdges ?? fromXY;
    if (!resolved) return undefined;
    if (
      resolved.top === 0 &&
      resolved.right === 0 &&
      resolved.bottom === 0 &&
      resolved.left === 0
    ) {
      return undefined;
    }
    return resolved;
  })();

  const safeStyle = {
    ...(fontFamily !== undefined ? { fontFamily } : {}),
    ...(hasWidth ? { width } : {}),
    ...(hasHeight ? { height } : {}),
    ...(fontSize !== undefined ? { fontSize } : {}),
    ...(fontWeight !== undefined ? { fontWeight } : {}),
    ...(color !== undefined ? { color } : {}),
    ...(colorAlpha !== undefined ? { colorAlpha } : {}),
    ...(textShadowEnabled !== undefined ? { textShadowEnabled } : {}),
    ...(textShadowColor !== undefined && textShadowColor.length > 0 ? { textShadowColor } : {}),
    ...(textShadowAlpha !== undefined ? { textShadowAlpha } : {}),
    ...(textShadowBlur !== undefined ? { textShadowBlur } : {}),
    ...(textShadowSpread !== undefined ? { textShadowSpread } : {}),
    ...(textShadowOffsetX !== undefined ? { textShadowOffsetX } : {}),
    ...(textShadowOffsetY !== undefined ? { textShadowOffsetY } : {}),
    ...(align !== undefined ? { align } : {}),
    ...(verticalAlign !== undefined ? { verticalAlign } : {}),
    ...(lineHeight !== undefined ? { lineHeight } : {}),
    ...(letterSpacing !== undefined ? { letterSpacing } : {}),
    ...(backgroundEnabled !== undefined ? { backgroundEnabled } : {}),
    ...(backgroundColor !== undefined && backgroundColor.length > 0 ? { backgroundColor } : {}),
    ...(backgroundAlpha !== undefined ? { backgroundAlpha } : {}),
    ...(backgroundRadius !== undefined ? { backgroundRadius } : {}),
    ...(backgroundShadowEnabled !== undefined ? { backgroundShadowEnabled } : {}),
    ...(backgroundShadowColor !== undefined && backgroundShadowColor.length > 0
      ? { backgroundShadowColor }
      : {}),
    ...(backgroundShadowAlpha !== undefined ? { backgroundShadowAlpha } : {}),
    ...(backgroundShadowBlur !== undefined ? { backgroundShadowBlur } : {}),
    ...(backgroundShadowSpread !== undefined ? { backgroundShadowSpread } : {}),
    ...(backgroundShadowOffsetX !== undefined ? { backgroundShadowOffsetX } : {}),
    ...(backgroundShadowOffsetY !== undefined ? { backgroundShadowOffsetY } : {}),
    ...(borderEnabled !== undefined ? { borderEnabled } : {}),
    ...(borderColor !== undefined && borderColor.length > 0 ? { borderColor } : {}),
    ...(borderAlpha !== undefined ? { borderAlpha } : {}),
    ...(borderWidth !== undefined ? { borderWidth } : {}),
    ...(paddingLinked !== undefined ? { paddingLinked } : {}),
    ...(padding !== undefined ? { padding } : {}),
  };

  if (Object.keys(safeStyle).length === 0) return undefined;
  return safeStyle;
}
