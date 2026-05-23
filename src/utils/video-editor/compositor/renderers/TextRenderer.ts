import { CanvasSource } from 'pixi.js';
import type { CompositorClip } from '../types';
import { computeTextLayoutMetrics } from '../../text-layout';

export class TextRenderer {
  /**
   * Ensures the clip has a valid OffscreenCanvas + 2D context for text rendering.
   * Switches the sprite texture source to a CanvasSource if needed.
   */
  public ensureCanvas(clip: CompositorClip): boolean {
    if (clip.canvas && clip.ctx) return true;

    const canvas = new OffscreenCanvas(2, 2);
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;

    clip.canvas = canvas;
    clip.ctx = ctx as OffscreenCanvasRenderingContext2D;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const canvasSource = new CanvasSource({ resource: canvas as any });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (clip.sprite as any).texture.source = canvasSource as any;
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
      const bgShadowSpreadPx = Math.round(normalizedStyle.backgroundShadowSpread * renderScale);
      const bgShadowRadius = Math.max(
        0,
        normalizedStyle.backgroundRadius * renderScale + bgShadowSpreadPx,
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
        frameX - bgShadowSpreadPx,
        frameY - bgShadowSpreadPx,
        Math.max(1, frameW + bgShadowSpreadPx * 2),
        Math.max(1, frameH + bgShadowSpreadPx * 2),
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
    const yOffsetPx = layout.yOffsetPx;

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
        yOffsetPx,
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
          yOffsetPx,
          letterSpacingPx,
          align: normalizedStyle.align,
          renderScale,
          mode: 'stroke',
        });
      }
      ctx.globalCompositeOperation = 'destination-out';
      ctx.shadowColor = 'transparent';
      ctx.globalAlpha = 1;
      this.drawTextLines({
        ctx,
        lines,
        localTextStartX,
        localTextTopPx,
        lineHeightPx,
        yOffsetPx,
        letterSpacingPx,
        align: normalizedStyle.align,
        renderScale,
      });
      if (textShadowSpreadPx > 0) {
        ctx.lineWidth = textShadowSpreadPx;
        this.drawTextLines({
          ctx,
          lines,
          localTextStartX,
          localTextTopPx,
          lineHeightPx,
          yOffsetPx,
          letterSpacingPx,
          align: normalizedStyle.align,
          renderScale,
          mode: 'stroke',
        });
      }
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
      yOffsetPx,
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
    yOffsetPx: number;
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
      yOffsetPx,
      letterSpacingPx,
      align,
      renderScale,
      mode = 'fill',
    } = params;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const lineY = localTextTopPx + i * lineHeightPx + lineHeightPx / 2 + yOffsetPx;

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

    // Measure total line width with letter spacing for alignment
    let totalWidth = 0;
    const charWidths: number[] = [];
    ctx.textAlign = 'left';
    const chars = Array.from(line);
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i] ?? '';
      const w = ctx.measureText(ch).width;
      charWidths.push(w);
      totalWidth += w + (i < chars.length - 1 ? letterSpacingPx : 0);
    }

    let x: number;
    if (params.align === 'right') {
      x = startX - totalWidth;
    } else if (params.align === 'center') {
      x = startX - totalWidth / 2;
    } else {
      x = startX;
    }

    for (let i = 0; i < chars.length; i++) {
      if (mode === 'stroke') {
        ctx.strokeText(chars[i] ?? '', x, y);
      } else {
        ctx.fillText(chars[i] ?? '', x, y);
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
    const trimmed = color.trim();
    const match = trimmed.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!match) return trimmed;

    const hex = match[1]!;
    const full =
      hex.length === 3
        ? hex
            .split('')
            .map((char) => `${char}${char}`)
            .join('')
        : hex;
    const value = Number.parseInt(full, 16);
    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;
    return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
  }
}
