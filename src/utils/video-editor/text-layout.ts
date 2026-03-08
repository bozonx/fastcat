import type { TextClipStyle } from '~/timeline/types';
import { TRANSFORM_DESIGN_BASE } from '~/utils/video-editor/clip-layout';

export interface NormalizedTextPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface NormalizedTextStyle {
  width?: number;
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  color: string;
  align: 'left' | 'center' | 'right';
  verticalAlign: 'top' | 'middle' | 'bottom';
  lineHeight: number;
  letterSpacing: number;
  backgroundColor: string;
  padding: NormalizedTextPadding;
}

export interface TextLayoutMetrics {
  style: NormalizedTextStyle;
  renderScale: number;
  fontSizePx: number;
  lineHeightPx: number;
  letterSpacingPx: number;
  explicitWidthPx?: number;
  contentWidthPx?: number;
  lines: string[];
  maxLineWidthPx: number;
  textBlockWidthPx: number;
  textBlockHeightPx: number;
  textBlockLeftPx: number;
  textBlockTopPx: number;
  backgroundX: number;
  backgroundY: number;
  backgroundWidth: number;
  backgroundHeight: number;
  textStartX: number;
  yOffsetPx: number;
  paddingPx: NormalizedTextPadding;
}

function clampFinite(value: unknown, fallback: number, min?: number, max?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const clampedMin = min === undefined ? value : Math.max(min, value);
  return max === undefined ? clampedMin : Math.min(max, clampedMin);
}

export function normalizeTextPadding(padding: TextClipStyle['padding']): NormalizedTextPadding {
  const clampPadding = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0, Math.min(10_000, value))
      : undefined;

  if (typeof padding === 'number') {
    const value = clampPadding(padding) ?? 0;
    return { top: value, right: value, bottom: value, left: value };
  }

  if (padding && typeof padding === 'object') {
    const rawPadding = padding as Record<string, unknown>;
    const x = clampPadding(rawPadding.x);
    const y = clampPadding(rawPadding.y);
    const top = clampPadding(rawPadding.top);
    const right = clampPadding(rawPadding.right);
    const bottom = clampPadding(rawPadding.bottom);
    const left = clampPadding(rawPadding.left);

    if (top !== undefined || right !== undefined || bottom !== undefined || left !== undefined) {
      return {
        top: top ?? 0,
        right: right ?? 0,
        bottom: bottom ?? 0,
        left: left ?? 0,
      };
    }

    if (x !== undefined || y !== undefined) {
      return {
        top: y ?? 0,
        right: x ?? 0,
        bottom: y ?? 0,
        left: x ?? 0,
      };
    }
  }

  return { top: 60, right: 60, bottom: 60, left: 60 };
}

export function normalizeTextClipStyle(style?: TextClipStyle): NormalizedTextStyle {
  return {
    width:
      typeof style?.width === 'number' && Number.isFinite(style.width) && style.width > 0
        ? style.width
        : undefined,
    fontFamily:
      typeof style?.fontFamily === 'string' && style.fontFamily.length > 0
        ? style.fontFamily
        : 'sans-serif',
    fontSize: clampFinite(style?.fontSize, 64, 1, 1000),
    fontWeight:
      typeof style?.fontWeight === 'string' || typeof style?.fontWeight === 'number'
        ? String(style.fontWeight)
        : '700',
    color: typeof style?.color === 'string' && style.color.length > 0 ? style.color : '#ffffff',
    align:
      style?.align === 'left' || style?.align === 'center' || style?.align === 'right'
        ? style.align
        : 'center',
    verticalAlign:
      style?.verticalAlign === 'top' ||
      style?.verticalAlign === 'middle' ||
      style?.verticalAlign === 'bottom'
        ? style.verticalAlign
        : 'middle',
    lineHeight: clampFinite(style?.lineHeight, 1.2, 0.1, 10),
    letterSpacing: clampFinite(style?.letterSpacing, 0, -1000, 1000),
    backgroundColor:
      typeof style?.backgroundColor === 'string' && style.backgroundColor.trim().length > 0
        ? style.backgroundColor.trim()
        : '',
    padding: normalizeTextPadding(style?.padding),
  };
}

export function computeTextLayoutMetrics(input: {
  text: string;
  style?: TextClipStyle;
  canvasWidth: number;
  canvasHeight: number;
  measureText: (text: string, font: string) => number;
}): TextLayoutMetrics {
  const safeCanvasWidth = Math.max(1, input.canvasWidth);
  const safeCanvasHeight = Math.max(1, input.canvasHeight);
  const renderScale = safeCanvasHeight / TRANSFORM_DESIGN_BASE.height;
  const normalizedStyle = normalizeTextClipStyle(input.style);
  const fontSizePx = Math.max(1, Math.round(normalizedStyle.fontSize * renderScale));
  const lineHeightPx = Math.max(1, Math.round(fontSizePx * normalizedStyle.lineHeight));
  const letterSpacingPx = Math.round(normalizedStyle.letterSpacing * renderScale);
  const paddingPx = {
    top: Math.round(normalizedStyle.padding.top * renderScale),
    right: Math.round(normalizedStyle.padding.right * renderScale),
    bottom: Math.round(normalizedStyle.padding.bottom * renderScale),
    left: Math.round(normalizedStyle.padding.left * renderScale),
  };
  const explicitWidthPx =
    normalizedStyle.width !== undefined
      ? Math.max(1, Math.round(normalizedStyle.width * renderScale))
      : undefined;
  const contentWidthPx =
    explicitWidthPx !== undefined
      ? Math.max(1, explicitWidthPx - paddingPx.left - paddingPx.right)
      : undefined;
  const font = `${normalizedStyle.fontWeight} ${fontSizePx}px ${normalizedStyle.fontFamily}`;
  const measureLine = (text: string) =>
    input.measureText(text, font) + Math.max(0, text.length - 1) * Math.max(0, letterSpacingPx);
  const wrapLine = (line: string): string[] => {
    if (contentWidthPx === undefined) return [line];
    const normalizedLine = String(line);
    if (normalizedLine.length === 0) return [''];

    const words = normalizedLine.split(/\s+/g);
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      const nextLine = currentLine.length > 0 ? `${currentLine} ${word}` : word;
      if (measureLine(nextLine) <= contentWidthPx || currentLine.length === 0) {
        currentLine = nextLine;
        continue;
      }
      lines.push(currentLine);
      currentLine = word;
    }

    lines.push(currentLine);
    return lines;
  };

  const paragraphs = String(input.text).split(/\r?\n/g);
  const lines = paragraphs.flatMap((paragraph) => wrapLine(paragraph));
  let maxLineWidthPx = 0;

  for (const line of lines) {
    if (line.length === 0) continue;
    const lineWidth = measureLine(line);
    if (lineWidth > maxLineWidthPx) {
      maxLineWidthPx = lineWidth;
    }
  }

  const textBlockWidthPx = contentWidthPx !== undefined ? contentWidthPx : maxLineWidthPx;
  const textBlockHeightPx = lines.length * lineHeightPx;

  let textBlockLeftPx = 0;
  if (normalizedStyle.align === 'left') {
    textBlockLeftPx = paddingPx.left;
  } else if (normalizedStyle.align === 'right') {
    textBlockLeftPx = safeCanvasWidth - paddingPx.right - textBlockWidthPx;
  } else {
    textBlockLeftPx = (safeCanvasWidth - textBlockWidthPx) / 2;
  }

  let textBlockTopPx = 0;
  if (normalizedStyle.verticalAlign === 'top') {
    textBlockTopPx = paddingPx.top;
  } else if (normalizedStyle.verticalAlign === 'bottom') {
    textBlockTopPx = safeCanvasHeight - paddingPx.bottom - textBlockHeightPx;
  } else {
    textBlockTopPx = (safeCanvasHeight - textBlockHeightPx) / 2;
  }

  const backgroundX = textBlockLeftPx - paddingPx.left;
  const backgroundY = textBlockTopPx - paddingPx.top;
  const backgroundWidth =
    explicitWidthPx !== undefined
      ? explicitWidthPx
      : textBlockWidthPx + paddingPx.left + paddingPx.right;
  const backgroundHeight = textBlockHeightPx + paddingPx.top + paddingPx.bottom;
  const textStartX =
    normalizedStyle.align === 'left'
      ? textBlockLeftPx
      : normalizedStyle.align === 'right'
        ? textBlockLeftPx + textBlockWidthPx
        : textBlockLeftPx + textBlockWidthPx / 2;
  const yOffsetPx = (lineHeightPx - fontSizePx) / 2;

  return {
    style: normalizedStyle,
    renderScale,
    fontSizePx,
    lineHeightPx,
    letterSpacingPx,
    explicitWidthPx,
    contentWidthPx,
    lines,
    maxLineWidthPx,
    textBlockWidthPx,
    textBlockHeightPx,
    textBlockLeftPx,
    textBlockTopPx,
    backgroundX,
    backgroundY,
    backgroundWidth,
    backgroundHeight,
    textStartX,
    yOffsetPx,
    paddingPx,
  };
}
