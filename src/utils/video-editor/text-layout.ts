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
  height?: number;
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  color: string;
  colorAlpha: number;
  colorBlendMode: string;
  textShadowEnabled: boolean;
  textShadowColor: string;
  textShadowAlpha: number;
  textShadowBlur: number;
  textShadowOffsetX: number;
  textShadowOffsetY: number;
  align: 'left' | 'center' | 'right';
  verticalAlign: 'top' | 'middle' | 'bottom';
  lineHeight: number;
  letterSpacing: number;
  backgroundEnabled: boolean;
  backgroundColor: string;
  backgroundAlpha: number;
  backgroundRadius: number;
  backgroundBlendMode: string;
  backgroundShadowEnabled: boolean;
  backgroundShadowColor: string;
  backgroundShadowAlpha: number;
  backgroundShadowBlur: number;
  backgroundShadowOffsetX: number;
  backgroundShadowOffsetY: number;
  borderEnabled: boolean;
  borderColor: string;
  borderAlpha: number;
  borderWidth: number;
  padding: NormalizedTextPadding;
}

export function mapBlendModeToComposite(mode: unknown): string {
  if (mode === 'add') return 'lighter';
  if (mode === 'multiply') return 'multiply';
  if (mode === 'screen') return 'screen';
  if (mode === 'darken') return 'darken';
  if (mode === 'lighten') return 'lighten';
  return 'source-over';
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
  frameX: number;
  frameY: number;
  frameWidth: number;
  frameHeight: number;
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
  const rawPadding = normalizeTextPadding(style?.padding);
  const padding =
    style?.paddingLinked === false
      ? rawPadding
      : {
          top: rawPadding.left,
          right: rawPadding.left,
          bottom: rawPadding.left,
          left: rawPadding.left,
        };

  return {
    width:
      typeof style?.width === 'number' && Number.isFinite(style.width) && style.width > 0
        ? style.width
        : undefined,
    height:
      typeof style?.height === 'number' && Number.isFinite(style.height) && style.height > 0
        ? style.height
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
    colorAlpha: clampFinite(style?.colorAlpha, 1, 0, 1),
    colorBlendMode: mapBlendModeToComposite(style?.colorBlendMode),
    textShadowEnabled:
      typeof style?.textShadowEnabled === 'boolean' ? style.textShadowEnabled : false,
    textShadowColor:
      typeof style?.textShadowColor === 'string' && style.textShadowColor.trim().length > 0
        ? style.textShadowColor.trim()
        : '#000000',
    textShadowAlpha: clampFinite(style?.textShadowAlpha, 1, 0, 1),
    textShadowBlur: clampFinite(style?.textShadowBlur, 0, 0, 10_000),
    textShadowOffsetX: clampFinite(style?.textShadowOffsetX, 0, -10_000, 10_000),
    textShadowOffsetY: clampFinite(style?.textShadowOffsetY, 0, -10_000, 10_000),
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
    backgroundEnabled:
      typeof style?.backgroundEnabled === 'boolean'
        ? style.backgroundEnabled
        : typeof style?.backgroundColor === 'string' && style.backgroundColor.trim().length > 0,
    backgroundColor:
      typeof style?.backgroundColor === 'string' && style.backgroundColor.trim().length > 0
        ? style.backgroundColor.trim()
        : '#000000',
    backgroundAlpha: clampFinite(style?.backgroundAlpha, 1, 0, 1),
    backgroundRadius: clampFinite(style?.backgroundRadius, 0, 0, 10_000),
    backgroundBlendMode: mapBlendModeToComposite(style?.backgroundBlendMode),
    backgroundShadowEnabled:
      typeof style?.backgroundShadowEnabled === 'boolean' ? style.backgroundShadowEnabled : false,
    backgroundShadowColor:
      typeof style?.backgroundShadowColor === 'string' &&
      style.backgroundShadowColor.trim().length > 0
        ? style.backgroundShadowColor.trim()
        : '#000000',
    backgroundShadowAlpha: clampFinite(style?.backgroundShadowAlpha, 1, 0, 1),
    backgroundShadowBlur: clampFinite(style?.backgroundShadowBlur, 0, 0, 10_000),
    backgroundShadowOffsetX: clampFinite(style?.backgroundShadowOffsetX, 0, -10_000, 10_000),
    backgroundShadowOffsetY: clampFinite(style?.backgroundShadowOffsetY, 0, -10_000, 10_000),
    borderEnabled: typeof style?.borderEnabled === 'boolean' ? style.borderEnabled : false,
    borderColor:
      typeof style?.borderColor === 'string' && style.borderColor.trim().length > 0
        ? style.borderColor.trim()
        : '#ffffff',
    borderAlpha: clampFinite(style?.borderAlpha, 1, 0, 1),
    borderWidth: clampFinite(style?.borderWidth, 0, 0, 10_000),
    padding,
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
  const explicitHeightPx =
    normalizedStyle.height !== undefined
      ? Math.max(1, Math.round(normalizedStyle.height * renderScale))
      : undefined;
  const contentWidthPx =
    explicitWidthPx !== undefined
      ? Math.max(1, explicitWidthPx - paddingPx.left - paddingPx.right)
      : undefined;
  const font = `${normalizedStyle.fontWeight} ${fontSizePx}px ${normalizedStyle.fontFamily}`;
  const measureLine = (text: string) =>
    input.measureText(text, font) +
    Math.max(0, Array.from(text).length - 1) * Math.max(0, letterSpacingPx);

  // Initialize a segmenter for word/grapheme boundaries, falling back to simple split if unsupported
  const segmenter =
    typeof Intl !== 'undefined' && Intl.Segmenter
      ? new Intl.Segmenter(undefined, { granularity: 'word' })
      : null;

  const wrapLine = (line: string): string[] => {
    if (contentWidthPx === undefined) return [line];
    const normalizedLine = String(line);
    if (normalizedLine.length === 0) return [''];

    const words: string[] = [];
    if (segmenter) {
      const segments = segmenter.segment(normalizedLine);
      let currentWord = '';
      for (const segment of segments) {
        if (segment.isWordLike) {
          currentWord += segment.segment;
        } else if (segment.segment.trim().length === 0) {
          if (currentWord.length > 0) words.push(currentWord);
          currentWord = '';
        } else {
          currentWord += segment.segment;
        }
      }
      if (currentWord.length > 0) words.push(currentWord);
    } else {
      words.push(...normalizedLine.split(/\s+/g));
    }

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

  const textBlockWidthPx = maxLineWidthPx;
  const textBlockHeightPx = lines.length * lineHeightPx;

  const frameContentWidthPx = contentWidthPx ?? textBlockWidthPx;
  const frameWidthPx = frameContentWidthPx + paddingPx.left + paddingPx.right;
  const autoFrameHeightPx = textBlockHeightPx + paddingPx.top + paddingPx.bottom;
  const frameHeightPx =
    explicitHeightPx !== undefined ? Math.max(explicitHeightPx, 1) : autoFrameHeightPx;
  const frameLeftPx = (safeCanvasWidth - frameWidthPx) / 2;
  const frameTopPx = (safeCanvasHeight - frameHeightPx) / 2;

  const contentLeftPx = frameLeftPx + paddingPx.left;
  let textBlockLeftPx = contentLeftPx;
  if (normalizedStyle.align === 'right') {
    textBlockLeftPx = contentLeftPx + frameContentWidthPx - textBlockWidthPx;
  } else if (normalizedStyle.align === 'center') {
    textBlockLeftPx = contentLeftPx + (frameContentWidthPx - textBlockWidthPx) / 2;
  }

  const contentTopPx = frameTopPx + paddingPx.top;
  const contentHeightPx = Math.max(1, frameHeightPx - paddingPx.top - paddingPx.bottom);
  let textBlockTopPx = contentTopPx;
  if (explicitHeightPx !== undefined && normalizedStyle.verticalAlign === 'bottom') {
    textBlockTopPx = contentTopPx + contentHeightPx - textBlockHeightPx;
  } else if (explicitHeightPx !== undefined && normalizedStyle.verticalAlign === 'middle') {
    textBlockTopPx = contentTopPx + (contentHeightPx - textBlockHeightPx) / 2;
  }

  const borderWidthPx =
    normalizedStyle.borderEnabled && normalizedStyle.borderWidth > 0
      ? Math.round(normalizedStyle.borderWidth * renderScale)
      : 0;
  const baseBackgroundX = frameLeftPx;
  const baseBackgroundY = frameTopPx;
  const backgroundShadowBlurPx = normalizedStyle.backgroundShadowEnabled
    ? Math.round(normalizedStyle.backgroundShadowBlur * renderScale)
    : 0;
  const backgroundShadowOffsetXPx = normalizedStyle.backgroundShadowEnabled
    ? Math.round(normalizedStyle.backgroundShadowOffsetX * renderScale)
    : 0;
  const backgroundShadowOffsetYPx = normalizedStyle.backgroundShadowEnabled
    ? Math.round(normalizedStyle.backgroundShadowOffsetY * renderScale)
    : 0;
  const textShadowBlurPx = normalizedStyle.textShadowEnabled
    ? Math.round(normalizedStyle.textShadowBlur * renderScale)
    : 0;
  const textShadowOffsetXPx = normalizedStyle.textShadowEnabled
    ? Math.round(normalizedStyle.textShadowOffsetX * renderScale)
    : 0;
  const textShadowOffsetYPx = normalizedStyle.textShadowEnabled
    ? Math.round(normalizedStyle.textShadowOffsetY * renderScale)
    : 0;
  const shadowLeft = Math.max(
    0,
    backgroundShadowBlurPx - backgroundShadowOffsetXPx,
    textShadowBlurPx - textShadowOffsetXPx,
  );
  const shadowRight = Math.max(
    0,
    backgroundShadowBlurPx + backgroundShadowOffsetXPx,
    textShadowBlurPx + textShadowOffsetXPx,
  );
  const shadowTop = Math.max(
    0,
    backgroundShadowBlurPx - backgroundShadowOffsetYPx,
    textShadowBlurPx - textShadowOffsetYPx,
  );
  const shadowBottom = Math.max(
    0,
    backgroundShadowBlurPx + backgroundShadowOffsetYPx,
    textShadowBlurPx + textShadowOffsetYPx,
  );
  const backgroundX = baseBackgroundX - borderWidthPx - shadowLeft;
  const backgroundY = baseBackgroundY - borderWidthPx - shadowTop;
  const backgroundWidth = frameWidthPx + borderWidthPx * 2 + shadowLeft + shadowRight;
  const backgroundHeight = frameHeightPx + borderWidthPx * 2 + shadowTop + shadowBottom;
  const textStartX =
    normalizedStyle.align === 'left'
      ? contentLeftPx
      : normalizedStyle.align === 'right'
        ? contentLeftPx + frameContentWidthPx
        : contentLeftPx + frameContentWidthPx / 2;
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
    frameX: baseBackgroundX - backgroundX,
    frameY: baseBackgroundY - backgroundY,
    frameWidth: frameWidthPx,
    frameHeight: frameHeightPx,
    textStartX,
    yOffsetPx,
    paddingPx,
  };
}
