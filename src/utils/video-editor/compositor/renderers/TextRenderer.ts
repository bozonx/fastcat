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

    const canvasSource = new CanvasSource({ resource: canvas as any });
    clip.sprite.texture.source = canvasSource as any;
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
    const { style: normalizedStyle, paddingPx } = layout;

    const bgW = Math.max(1, Math.ceil(layout.backgroundWidth));
    const bgH = Math.max(1, Math.ceil(layout.backgroundHeight));

    const canvas = clip.canvas!;
    if (canvas.width !== bgW || canvas.height !== bgH) {
      canvas.width = bgW;
      canvas.height = bgH;
      try {
        if (typeof (clip.sprite.texture.source as any)?.resize === 'function') {
          (clip.sprite.texture.source as any).resize(bgW, bgH);
        }
      } catch {
        // ignore
      }
    }

    ctx.clearRect(0, 0, bgW, bgH);

    // Draw background
    if (normalizedStyle.backgroundColor) {
      ctx.fillStyle = normalizedStyle.backgroundColor;
      ctx.fillRect(0, 0, bgW, bgH);
    }

    // Draw text lines
    const font = `${normalizedStyle.fontWeight} ${fontSizePx}px ${normalizedStyle.fontFamily}`;
    ctx.font = font;
    ctx.fillStyle = normalizedStyle.color;
    ctx.textBaseline = 'middle';
    ctx.textAlign = normalizedStyle.align;

    // textStartX is relative to the compositor canvas; convert to local canvas coords
    const localTextStartX = layout.textStartX - layout.backgroundX;
    const yOffsetPx = layout.yOffsetPx;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const lineY = paddingPx.top + i * lineHeightPx + lineHeightPx / 2 + yOffsetPx;

      if (letterSpacingPx === 0) {
        ctx.fillText(line, localTextStartX, lineY);
      } else {
        this.drawLineWithLetterSpacing({
          ctx,
          line,
          startX: layout.textStartX - layout.backgroundX,
          y: lineY,
          align: normalizedStyle.align,
          letterSpacingPx,
          renderScale,
        });
      }
    }

    try {
      (clip.sprite.texture.source as any)?.update?.();
    } catch {
      // ignore
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
  }): void {
    const { ctx, line, startX, y, letterSpacingPx } = params;

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
      ctx.fillText(chars[i] ?? '', x, y);
      x += (charWidths[i] ?? 0) + letterSpacingPx;
    }
  }
}
