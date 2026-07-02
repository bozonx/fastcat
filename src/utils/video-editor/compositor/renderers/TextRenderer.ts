import { CanvasSource, Texture } from 'pixi.js';
import type { CompositorClip } from '../types';
import { computeTextLayoutMetrics, getTextBackgroundShadowOutsetPx } from '../../text-layout';
import { TRANSFORM_DESIGN_BASE } from '../../clip-layout';

export class TextRenderer {
  constructor(
    private readonly context: {
      designWidth: number;
      designHeight: number;
    } = {
      designWidth: TRANSFORM_DESIGN_BASE.width,
      designHeight: TRANSFORM_DESIGN_BASE.height,
    },
  ) {}

  /**
   * Ensures the clip has a valid OffscreenCanvas + 2D context for text rendering.
   * Switches the sprite texture source to a CanvasSource if needed.
   */
  public ensureCanvas(clip: CompositorClip): boolean {
    if (clip.canvas && clip.ctx) return true;

    const canvas = new OffscreenCanvas(2, 2);
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;

    // Guard against lost 2D context (e.g. GPU pressure)
    try {
      ctx.clearRect(0, 0, 1, 1);
    } catch {
      return false;
    }

    clip.canvas = canvas;
    clip.ctx = ctx as OffscreenCanvasRenderingContext2D;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const canvasSource = new CanvasSource({ resource: canvas as any });

    // Create a new unique Texture for this text clip sprite instead of mutating Texture.EMPTY.
    // `dynamic` is required: the canvas source is resized on every text/style change,
    // and a non-dynamic Sprite never re-reads the texture size after construction
    // (Pixi only subscribes to texture updates when `texture.dynamic` is true),
    // which leaves the quad at the old size and squashes the redrawn text.
    const texture = new Texture({ source: canvasSource, dynamic: true });
    clip.sprite!.texture = texture;
    clip.sourceKind = 'canvas';
    return true;
  }

  /**
   * Renders the text clip into its OffscreenCanvas using Canvas2D.
   * Supports background color, padding, letter-spacing, vertical align, word-wrap.
   */
  public draw(clip: CompositorClip, canvasWidth: number, canvasHeight: number): void {
    if (!this.ensureCanvas(clip)) return;

    const ctx = clip.ctx!;
    const text = String(clip.text ?? '');
    const style = clip.style;

    const layout = computeTextLayoutMetrics({
      text,
      style,
      canvasWidth,
      canvasHeight,
      designWidth: this.context.designWidth,
      designHeight: this.context.designHeight,
      measureText: (t, font) => {
        ctx.font = font;
        return ctx.measureText(t).width;
      },
    });

    const { renderScale, fontSizePx, lineHeightPx, letterSpacingPx, lines } = layout;
    const { style: normalizedStyle } = layout;

    const bgW = Math.max(1, Math.ceil(layout.backgroundWidth));
    const bgH = Math.max(1, Math.ceil(layout.backgroundHeight));

    const canvas = clip.canvas!;
    if (canvas.width !== bgW || canvas.height !== bgH) {
      canvas.width = bgW;
      canvas.height = bgH;
      try {
        const textureSource = this.getTextureSource(clip);
        if (typeof textureSource?.resize === 'function') {
          textureSource.resize(bgW, bgH);
        }
      } catch {
        // ignore
      }
    }

    ctx.clearRect(0, 0, bgW, bgH);

    const borderWidthPx =
      normalizedStyle.borderEnabled && normalizedStyle.borderWidth > 0
        ? Math.round(normalizedStyle.borderWidth * renderScale)
        : 0;
    const frameX = layout.frameX;
    const frameY = layout.frameY;
    const frameW = Math.max(1, layout.frameWidth);
    const frameH = Math.max(1, layout.frameHeight);

    if (normalizedStyle.backgroundEnabled && normalizedStyle.backgroundShadowEnabled) {
      const bgShadowOutsetPx = getTextBackgroundShadowOutsetPx(normalizedStyle, renderScale);
      const bgShadowRadius = Math.max(
        0,
        normalizedStyle.backgroundRadius * renderScale + bgShadowOutsetPx,
      );
      ctx.save();
      ctx.globalAlpha = normalizedStyle.backgroundShadowAlpha;
      ctx.fillStyle = normalizedStyle.backgroundShadowColor;
      ctx.shadowColor = this.toCanvasShadowColor(normalizedStyle.backgroundShadowColor, 1);
      ctx.shadowBlur = normalizedStyle.backgroundShadowBlur * renderScale;
      ctx.shadowOffsetX = normalizedStyle.backgroundShadowOffsetX * renderScale;
      ctx.shadowOffsetY = normalizedStyle.backgroundShadowOffsetY * renderScale;
      this.drawRoundedRect(
        ctx,
        frameX - bgShadowOutsetPx,
        frameY - bgShadowOutsetPx,
        Math.max(1, frameW + bgShadowOutsetPx * 2),
        Math.max(1, frameH + bgShadowOutsetPx * 2),
        bgShadowRadius,
      );
      ctx.fill();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.shadowColor = 'transparent';
      ctx.globalAlpha = 1;
      this.drawRoundedRect(
        ctx,
        frameX,
        frameY,
        frameW,
        frameH,
        normalizedStyle.backgroundRadius * renderScale,
      );
      ctx.fill();
      ctx.restore();
    }

    if (normalizedStyle.backgroundEnabled) {
      ctx.save();
      ctx.globalAlpha = normalizedStyle.backgroundAlpha;
      ctx.fillStyle = normalizedStyle.backgroundColor;
      this.drawRoundedRect(
        ctx,
        frameX,
        frameY,
        frameW,
        frameH,
        normalizedStyle.backgroundRadius * renderScale,
      );
      ctx.fill();
      ctx.restore();
    }

    if (normalizedStyle.borderEnabled && borderWidthPx > 0) {
      ctx.save();
      ctx.globalAlpha = normalizedStyle.borderAlpha;
      ctx.strokeStyle = normalizedStyle.borderColor;
      ctx.lineWidth = borderWidthPx;
      const inset = borderWidthPx / 2;
      this.drawRoundedRect(
        ctx,
        frameX - inset,
        frameY - inset,
        Math.max(1, frameW + borderWidthPx),
        Math.max(1, frameH + borderWidthPx),
        Math.max(0, normalizedStyle.backgroundRadius * renderScale + inset),
      );
      ctx.stroke();
      ctx.restore();
    }

    // Draw text lines
    const font = `${normalizedStyle.fontWeight} ${fontSizePx}px ${normalizedStyle.fontFamily}`;
    ctx.font = font;

    // textStartX is relative to the compositor canvas; convert to local canvas coords
    const localTextStartX = layout.textStartX - layout.backgroundX;
    const localTextTopPx = layout.textBlockTopPx - layout.backgroundY;

    if (normalizedStyle.textShadowEnabled) {
      const textShadowSpreadPx = Math.round(normalizedStyle.textShadowSpread * renderScale);
      ctx.save();
      ctx.font = font;
      ctx.fillStyle = normalizedStyle.textShadowColor;
      ctx.globalAlpha = normalizedStyle.textShadowAlpha;
      ctx.shadowColor = this.toCanvasShadowColor(normalizedStyle.textShadowColor, 1);
      ctx.shadowBlur = normalizedStyle.textShadowBlur * renderScale;
      ctx.shadowOffsetX = normalizedStyle.textShadowOffsetX * renderScale;
      ctx.shadowOffsetY = normalizedStyle.textShadowOffsetY * renderScale;
      ctx.textBaseline = 'middle';
      ctx.textAlign = normalizedStyle.align;
      this.drawTextLines({
        ctx,
        lines,
        localTextStartX,
        localTextTopPx,
        lineHeightPx,
        letterSpacingPx,
        align: normalizedStyle.align,
        renderScale,
      });
      if (textShadowSpreadPx > 0) {
        ctx.lineWidth = textShadowSpreadPx;
        ctx.strokeStyle = normalizedStyle.textShadowColor;
        this.drawTextLines({
          ctx,
          lines,
          localTextStartX,
          localTextTopPx,
          lineHeightPx,
          letterSpacingPx,
          align: normalizedStyle.align,
          renderScale,
          mode: 'stroke',
        });
      }
      // Cut only the glyph FILL (interior) out of the shadow so the main text
      // sits cleanly on top. Do NOT cut the spread stroke back out — that would
      // cancel the dilation added above and collapse the shadow into a thin
      // offset-only outline that appears detached from the text.
      ctx.globalCompositeOperation = 'destination-out';
      ctx.shadowColor = 'transparent';
      ctx.globalAlpha = 1;
      this.drawTextLines({
        ctx,
        lines,
        localTextStartX,
        localTextTopPx,
        lineHeightPx,
        letterSpacingPx,
        align: normalizedStyle.align,
        renderScale,
      });
      ctx.restore();
    }

    ctx.fillStyle = normalizedStyle.color;
    ctx.globalAlpha = normalizedStyle.colorAlpha;
    ctx.textBaseline = 'middle';
    ctx.textAlign = normalizedStyle.align;
    this.drawTextLines({
      ctx,
      lines,
      localTextStartX,
      localTextTopPx,
      lineHeightPx,
      letterSpacingPx,
      align: normalizedStyle.align,
      renderScale,
    });
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    try {
      this.getTextureSource(clip)?.update?.();
    } catch {
      // ignore
    }
  }

  private getTextureSource(
    clip: CompositorClip,
  ): { resize?: (width: number, height: number) => void; update?: () => void } | undefined {
    return (clip.sprite as { texture?: { source?: unknown } } | null)?.texture?.source as
      | { resize?: (width: number, height: number) => void; update?: () => void }
      | undefined;
  }

  private drawTextLines(params: {
    ctx: OffscreenCanvasRenderingContext2D;
    lines: string[];
    localTextStartX: number;
    localTextTopPx: number;
    lineHeightPx: number;
    letterSpacingPx: number;
    align: 'left' | 'center' | 'right';
    renderScale: number;
    mode?: 'fill' | 'stroke';
  }): void {
    const {
      ctx,
      lines,
      localTextStartX,
      localTextTopPx,
      lineHeightPx,
      letterSpacingPx,
      align,
      renderScale,
      mode = 'fill',
    } = params;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const lineY = localTextTopPx + i * lineHeightPx + lineHeightPx / 2;

      if (letterSpacingPx === 0) {
        if (mode === 'stroke') {
          ctx.strokeText(line, localTextStartX, lineY);
        } else {
          ctx.fillText(line, localTextStartX, lineY);
        }
      } else {
        this.drawLineWithLetterSpacing({
          ctx,
          line,
          startX: localTextStartX,
          y: lineY,
          align,
          letterSpacingPx,
          renderScale,
          mode,
        });
      }
    }
  }

  private drawLineWithLetterSpacing(params: {
    ctx: OffscreenCanvasRenderingContext2D;
    line: string;
    startX: number;
    y: number;
    align: 'left' | 'center' | 'right';
    letterSpacingPx: number;
    renderScale: number;
    mode?: 'fill' | 'stroke';
  }): void {
    const { ctx, line, startX, y, letterSpacingPx, mode = 'fill' } = params;

    // Prefer native letterSpacing when available (handles RTL, emoji, ligatures, perf)
    const ctxWithSpacing = ctx as unknown as CanvasRenderingContext2D & { letterSpacing?: string };
    if (typeof ctxWithSpacing.letterSpacing === 'string') {
      ctx.textAlign = params.align;
      ctxWithSpacing.letterSpacing = `${letterSpacingPx}px`;
      if (mode === 'stroke') {
        ctx.strokeText(line, startX, y);
      } else {
        ctx.fillText(line, startX, y);
      }
      ctxWithSpacing.letterSpacing = '0px';
      return;
    }

    // Fallback: grapheme-aware per-glyph rendering (better than per-code-point for emoji)
    const segmenter =
      typeof Intl !== 'undefined' && Intl.Segmenter
        ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
        : null;
    const graphemes: string[] = segmenter
      ? Array.from(segmenter.segment(line), (s: { segment: string }) => s.segment)
      : Array.from(line);

    let totalWidth = 0;
    const charWidths: number[] = [];
    ctx.textAlign = 'left';
    for (let i = 0; i < graphemes.length; i++) {
      const ch = graphemes[i] ?? '';
      const w = ctx.measureText(ch).width;
      charWidths.push(w);
      totalWidth += w + (i < graphemes.length - 1 ? letterSpacingPx : 0);
    }

    let x: number;
    if (params.align === 'right') {
      x = startX - totalWidth;
    } else if (params.align === 'center') {
      x = startX - totalWidth / 2;
    } else {
      x = startX;
    }

    for (let i = 0; i < graphemes.length; i++) {
      if (mode === 'stroke') {
        ctx.strokeText(graphemes[i] ?? '', x, y);
      } else {
        ctx.fillText(graphemes[i] ?? '', x, y);
      }
      x += (charWidths[i] ?? 0) + letterSpacingPx;
    }
  }

  private drawRoundedRect(
    ctx: OffscreenCanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ): void {
    const safeRadius = Math.min(Math.max(0, radius), width / 2, height / 2);

    ctx.beginPath();
    ctx.moveTo(x + safeRadius, y);
    ctx.lineTo(x + width - safeRadius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
    ctx.lineTo(x + width, y + height - safeRadius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
    ctx.lineTo(x + safeRadius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
    ctx.lineTo(x, y + safeRadius);
    ctx.quadraticCurveTo(x, y, x + safeRadius, y);
    ctx.closePath();
  }

  private toCanvasShadowColor(color: string, alpha: number): string {
    const trimmed = color.trim().toLowerCase();

    // Named colors map (subset of CSS named colors)
    const namedColors: Record<string, string> = {
      black: '#000000',
      white: '#ffffff',
      red: '#ff0000',
      green: '#008000',
      blue: '#0000ff',
      yellow: '#ffff00',
      cyan: '#00ffff',
      magenta: '#ff00ff',
      silver: '#c0c0c0',
      gray: '#808080',
      grey: '#808080',
      maroon: '#800000',
      olive: '#808000',
      lime: '#00ff00',
      aqua: '#00ffff',
      teal: '#008080',
      navy: '#000080',
      fuchsia: '#ff00ff',
      purple: '#800080',
      orange: '#ffa500',
    };
    const named = namedColors[trimmed];
    if (named) {
      return this.hexToRgba(named, alpha);
    }

    // #rgb / #rrggbb
    const hexMatch = trimmed.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hexMatch) {
      return this.hexToRgba('#' + hexMatch[1], alpha);
    }

    // rgb(r,g,b)
    const rgbMatch = trimmed.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/);
    if (rgbMatch) {
      return `rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, ${Math.max(0, Math.min(1, alpha))})`;
    }

    // rgba(r,g,b,a)
    const rgbaMatch = trimmed.match(
      /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*([\d.]+)\s*\)$/,
    );
    if (rgbaMatch) {
      const a = Math.max(0, Math.min(1, Number(rgbaMatch[4]) * alpha));
      return `rgba(${rgbaMatch[1]}, ${rgbaMatch[2]}, ${rgbaMatch[3]}, ${a})`;
    }

    // Already rgba with alpha multiplier applied
    if (trimmed.startsWith('rgba(')) {
      return trimmed;
    }

    return trimmed;
  }

  private hexToRgba(hex: string, alpha: number): string {
    const clean = hex.replace('#', '');
    const full =
      clean.length === 3
        ? clean
            .split('')
            .map((c) => c + c)
            .join('')
        : clean;
    const value = Number.parseInt(full, 16);
    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;
    return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
  }
}
