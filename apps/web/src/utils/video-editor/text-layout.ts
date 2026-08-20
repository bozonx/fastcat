import type { TextClipStyle } from '~/timeline/types';
import { clamp as sharedClamp, clampFinite as _sharedClampFinite } from '~/utils/math';
import { TRANSFORM_DESIGN_BASE } from '~/utils/video-editor/clip-layout';

/**
 * A blur radius maps to a Gaussian with σ ≈ blur/2; its visible tail reaches
 * ~3σ = 1.5·blur. We reserve that much room around the text frame when sizing
 * the shadow's bounding box so the blurred halo is not clipped at the texture
 * edge. Must match the native compositor's `SHADOW_BLUR_EXTENT_FACTOR`
 * (`src-tauri/.../scene_build/layer_builder.rs`) so web preview, native preview
 * and export all reserve the same headroom.
 */
export const SHADOW_BLUR_EXTENT_FACTOR = 1.5;

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
  textShadowEnabled: boolean;
  textShadowColor: string;
  textShadowAlpha: number;
  textShadowBlur: number;
  textShadowSpread: number;
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
  backgroundShadowEnabled: boolean;
  backgroundShadowColor: string;
  backgroundShadowAlpha: number;
  backgroundShadowBlur: number;
  backgroundShadowSpread: number;
  backgroundShadowOffsetX: number;
  backgroundShadowOffsetY: number;
  borderEnabled: boolean;
  borderColor: string;
  borderAlpha: number;
  borderWidth: number;
  borderOffset: number;
  padding: NormalizedTextPadding;
}

/**
 * Device-space distance the border extends outward from the background box:
 * the border's own width plus the creative gap (`borderOffset`). Both renderers
 * and the layout reserve this much room outside the frame so the border and gap
 * are not clipped. Returns 0 when the border is disabled.
 */
export function getTextBorderOutsetPx(style: NormalizedTextStyle, renderScale: number): number {
  if (!style.borderEnabled || style.borderWidth <= 0) return 0;
  const borderWidthPx = Math.round(style.borderWidth * renderScale);
  const borderOffsetPx = Math.round(style.borderOffset * renderScale);
  return Math.max(0, borderWidthPx + Math.max(0, borderOffsetPx));
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

export function getTextBackgroundShadowOutsetPx(
  style: NormalizedTextStyle,
  renderScale: number,
): number {
  const borderOutsetPx = getTextBorderOutsetPx(style, renderScale);
  const shadowSpreadPx = Math.round(style.backgroundShadowSpread * renderScale);

  return Math.max(0, borderOutsetPx + shadowSpreadPx);
}

function clampFinite(value: unknown, fallback: number, min?: number, max?: number): number {
  const parsed = value !== null && value !== undefined && value !== '' ? Number(value) : NaN;
  const finite = Number.isFinite(parsed) ? parsed : fallback;
  if (min === undefined && max === undefined) return finite;
  const safeMin = min ?? Number.NEGATIVE_INFINITY;
  const safeMax = max ?? Number.POSITIVE_INFINITY;
  return sharedClamp(finite, safeMin, safeMax);
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

export function getFontStack(fontFamily: string): string {
  const normalized = fontFamily.trim();

  if (normalized.includes(',')) {
    return normalized;
  }

  const fontStacks: Record<string, string> = {
    Inter: '"Inter", sans-serif',
    Roboto: '"Roboto", sans-serif',
    Montserrat: '"Montserrat", sans-serif',
    Oswald: '"Oswald", sans-serif',
    'Noto Sans': '"Noto Sans", sans-serif',
    'Playfair Display': '"Playfair Display", serif',
    Arial: 'Arial, sans-serif',
    'Arial Black': '"Arial Black", "Arial Bold", sans-serif',
    Verdana: 'Verdana, sans-serif',
    Tahoma: 'Tahoma, sans-serif',
    'Trebuchet MS': '"Trebuchet MS", sans-serif',
    Georgia: 'Georgia, serif',
    'Times New Roman': '"Times New Roman", Times, serif',
    'Courier New': '"Courier New", Courier, monospace',
    Impact: 'Impact, Charcoal, "Arial Narrow Bold", sans-serif',
    'Bebas Neue': '"Bebas Neue", sans-serif',
    Rubik: '"Rubik", sans-serif',
    Fredoka: '"Fredoka", sans-serif',
    'JetBrains Mono': '"JetBrains Mono", monospace',
    Caveat: '"Caveat", cursive',
    'sans-serif': 'sans-serif',
    serif: 'serif',
    monospace: 'monospace',
  };

  if (fontStacks[normalized]) {
    return fontStacks[normalized]!;
  }

  if (/\s/.test(normalized) && !/^['"].*['"]$/.test(normalized)) {
    return `"${normalized}", sans-serif`;
  }

  return `${normalized}, sans-serif`;
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
        ? getFontStack(style.fontFamily)
        : 'sans-serif',
    fontSize: clampFinite(style?.fontSize, 64, 1, 1000),
    fontWeight:
      typeof style?.fontWeight === 'string' || typeof style?.fontWeight === 'number'
        ? String(style.fontWeight)
        : '700',
    color: typeof style?.color === 'string' && style.color.length > 0 ? style.color : '#ffffff',
    colorAlpha: clampFinite(style?.colorAlpha, 1, 0, 1),
    textShadowEnabled:
      typeof style?.textShadowEnabled === 'boolean' ? style.textShadowEnabled : false,
    textShadowColor:
      typeof style?.textShadowColor === 'string' && style.textShadowColor.trim().length > 0
        ? style.textShadowColor.trim()
        : '#000000',
    textShadowAlpha: clampFinite(style?.textShadowAlpha, 1, 0, 1),
    textShadowBlur: clampFinite(style?.textShadowBlur, 0, 0, 10_000),
    textShadowSpread: clampFinite(style?.textShadowSpread, 0, 0, 10_000),
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
    backgroundShadowEnabled:
      typeof style?.backgroundShadowEnabled === 'boolean' ? style.backgroundShadowEnabled : false,
    backgroundShadowColor:
      typeof style?.backgroundShadowColor === 'string' &&
      style.backgroundShadowColor.trim().length > 0
        ? style.backgroundShadowColor.trim()
        : '#000000',
    backgroundShadowAlpha: clampFinite(style?.backgroundShadowAlpha, 1, 0, 1),
    backgroundShadowBlur: clampFinite(style?.backgroundShadowBlur, 0, 0, 10_000),
    backgroundShadowSpread: clampFinite(style?.backgroundShadowSpread, 0, 0, 10_000),
    backgroundShadowOffsetX: clampFinite(style?.backgroundShadowOffsetX, 0, -10_000, 10_000),
    backgroundShadowOffsetY: clampFinite(style?.backgroundShadowOffsetY, 0, -10_000, 10_000),
    borderEnabled: typeof style?.borderEnabled === 'boolean' ? style.borderEnabled : false,
    borderColor:
      typeof style?.borderColor === 'string' && style.borderColor.trim().length > 0
        ? style.borderColor.trim()
        : '#ffffff',
    borderAlpha: clampFinite(style?.borderAlpha, 1, 0, 1),
    borderWidth: clampFinite(style?.borderWidth, 0, 0, 10_000),
    borderOffset: clampFinite(style?.borderOffset, 0, 0, 10_000),
    padding,
  };
}

export function computeTextLayoutMetrics(input: {
  text: string;
  style?: TextClipStyle;
  canvasWidth: number;
  canvasHeight: number;
  designWidth?: number;
  designHeight?: number;
  measureText: (text: string, font: string) => number;
}): TextLayoutMetrics {
  const safeCanvasWidth = Math.max(1, input.canvasWidth);
  const safeCanvasHeight = Math.max(1, input.canvasHeight);
  const safeDesignWidth = Math.max(1, input.designWidth ?? TRANSFORM_DESIGN_BASE.width);
  const safeDesignHeight = Math.max(1, input.designHeight ?? TRANSFORM_DESIGN_BASE.height);
  const renderScale = Math.min(
    safeCanvasWidth / safeDesignWidth,
    safeCanvasHeight / safeDesignHeight,
  );
  const normalizedStyle = normalizeTextClipStyle(input.style);
  const fontSizePx = Math.max(1, normalizedStyle.fontSize * renderScale);
  const lineHeightPx = Math.max(1, fontSizePx * normalizedStyle.lineHeight);
  const letterSpacingPx = normalizedStyle.letterSpacing * renderScale;
  const paddingPx = {
    top: normalizedStyle.padding.top * renderScale,
    right: normalizedStyle.padding.right * renderScale,
    bottom: normalizedStyle.padding.bottom * renderScale,
    left: normalizedStyle.padding.left * renderScale,
  };
  const explicitWidthPx =
    normalizedStyle.width !== undefined
      ? Math.max(1, normalizedStyle.width * renderScale)
      : undefined;
  const explicitHeightPx =
    normalizedStyle.height !== undefined
      ? Math.max(1, normalizedStyle.height * renderScale)
      : undefined;
  const contentWidthPx =
    explicitWidthPx !== undefined
      ? Math.max(1, explicitWidthPx - paddingPx.left - paddingPx.right)
      : undefined;
  const font = `${normalizedStyle.fontWeight} ${fontSizePx}px ${normalizedStyle.fontFamily}`;
  const wordSegmenter =
    typeof Intl !== 'undefined' && Intl.Segmenter
      ? new Intl.Segmenter(undefined, { granularity: 'word' })
      : null;
  const graphemeSegmenter =
    typeof Intl !== 'undefined' && Intl.Segmenter
      ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
      : null;
  const splitGraphemes = (text: string) =>
    graphemeSegmenter
      ? Array.from(graphemeSegmenter.segment(text), (segment) => segment.segment)
      : Array.from(text);

  const measureLine = (text: string) => {
    const graphemeCount = splitGraphemes(text).length;
    return input.measureText(text, font) + Math.max(0, graphemeCount - 1) * letterSpacingPx;
  };

  const wrapLine = (line: string): string[] => {
    if (contentWidthPx === undefined) return [line];
    const normalizedLine = String(line);
    if (normalizedLine.length === 0) return [''];

    const words: string[] = [];
    if (wordSegmenter) {
      const segments = wordSegmenter.segment(normalizedLine);
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
      if (measureLine(nextLine) <= contentWidthPx) {
        currentLine = nextLine;
        continue;
      }

      if (currentLine.length > 0) {
        lines.push(currentLine);
        currentLine = '';
      }

      // Force-break the word if it is wider than the line by itself
      if (contentWidthPx > 0 && measureLine(word) > contentWidthPx) {
        const graphemes = splitGraphemes(word);
        for (const g of graphemes) {
          const test = currentLine.length > 0 ? `${currentLine}${g}` : g;
          if (measureLine(test) <= contentWidthPx || currentLine.length === 0) {
            currentLine = test;
          } else {
            lines.push(currentLine);
            currentLine = g;
          }
        }
      } else {
        currentLine = word;
      }
    }

    if (currentLine.length > 0) {
      lines.push(currentLine);
    }
    return lines.length > 0 ? lines : [''];
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
    explicitHeightPx !== undefined
      ? Math.max(explicitHeightPx, autoFrameHeightPx, 1)
      : autoFrameHeightPx;
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

  // Room reserved outside the frame for the border: its width plus the creative
  // gap (`borderOffset`), so a pushed-out border isn't clipped at the texture edge.
  const borderOutsetPx = getTextBorderOutsetPx(normalizedStyle, renderScale);
  const baseBackgroundX = frameLeftPx;
  const baseBackgroundY = frameTopPx;
  const backgroundShadowBlurExtentPx = normalizedStyle.backgroundShadowEnabled
    ? Math.round(normalizedStyle.backgroundShadowBlur * renderScale * SHADOW_BLUR_EXTENT_FACTOR)
    : 0;
  const backgroundShadowSpreadPx = normalizedStyle.backgroundShadowEnabled
    ? Math.round(normalizedStyle.backgroundShadowSpread * renderScale)
    : 0;
  const backgroundShadowOffsetXPx = normalizedStyle.backgroundShadowEnabled
    ? Math.round(normalizedStyle.backgroundShadowOffsetX * renderScale)
    : 0;
  const backgroundShadowOffsetYPx = normalizedStyle.backgroundShadowEnabled
    ? Math.round(normalizedStyle.backgroundShadowOffsetY * renderScale)
    : 0;
  const textShadowBlurExtentPx = normalizedStyle.textShadowEnabled
    ? Math.round(normalizedStyle.textShadowBlur * renderScale * SHADOW_BLUR_EXTENT_FACTOR)
    : 0;
  const textShadowSpreadPx = normalizedStyle.textShadowEnabled
    ? Math.round(normalizedStyle.textShadowSpread * renderScale)
    : 0;
  const textShadowOffsetXPx = normalizedStyle.textShadowEnabled
    ? Math.round(normalizedStyle.textShadowOffsetX * renderScale)
    : 0;
  const textShadowOffsetYPx = normalizedStyle.textShadowEnabled
    ? Math.round(normalizedStyle.textShadowOffsetY * renderScale)
    : 0;
  const shadowLeft = Math.max(
    0,
    backgroundShadowBlurExtentPx + backgroundShadowSpreadPx - backgroundShadowOffsetXPx,
    textShadowBlurExtentPx + textShadowSpreadPx - textShadowOffsetXPx,
  );
  const shadowRight = Math.max(
    0,
    backgroundShadowBlurExtentPx + backgroundShadowSpreadPx + backgroundShadowOffsetXPx,
    textShadowBlurExtentPx + textShadowSpreadPx + textShadowOffsetXPx,
  );
  const shadowTop = Math.max(
    0,
    backgroundShadowBlurExtentPx + backgroundShadowSpreadPx - backgroundShadowOffsetYPx,
    textShadowBlurExtentPx + textShadowSpreadPx - textShadowOffsetYPx,
  );
  const shadowBottom = Math.max(
    0,
    backgroundShadowBlurExtentPx + backgroundShadowSpreadPx + backgroundShadowOffsetYPx,
    textShadowBlurExtentPx + textShadowSpreadPx + textShadowOffsetYPx,
  );
  const backgroundX = baseBackgroundX - borderOutsetPx - shadowLeft;
  const backgroundY = baseBackgroundY - borderOutsetPx - shadowTop;
  const backgroundWidth = frameWidthPx + borderOutsetPx * 2 + shadowLeft + shadowRight;
  const backgroundHeight = frameHeightPx + borderOutsetPx * 2 + shadowTop + shadowBottom;
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
