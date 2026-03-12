import type { ShapeConfig, ShapeType } from '~/timeline/types';
import { parseHexColor } from '../../utils';

export interface ShapeDrawParams {
  graphics: any;
  type: ShapeType;
  fill: string;
  stroke: string;
  strokeWidth: number;
  config: ShapeConfig;
  canvasWidth: number;
  canvasHeight: number;
}

export interface ShapeLayoutResult {
  targetW: number;
  targetH: number;
  baseX: number;
  baseY: number;
}

export class ShapeRenderer {
  public computeLayout(params: {
    canvasWidth: number;
    canvasHeight: number;
    strokeWidth: number;
  }): ShapeLayoutResult {
    const { canvasWidth, canvasHeight, strokeWidth } = params;
    const size = Math.min(canvasWidth, canvasHeight) * 0.8;
    const targetW = Math.max(1, Math.ceil(size + strokeWidth * 2));
    const targetH = Math.max(1, Math.ceil(size + strokeWidth * 2));
    const baseX = (canvasWidth - targetW) / 2;
    const baseY = (canvasHeight - targetH) / 2;
    return { targetW, targetH, baseX, baseY };
  }

  public draw(params: ShapeDrawParams): void {
    const { graphics, type, fill, stroke, strokeWidth, config, canvasWidth, canvasHeight } = params;

    graphics.clear();

    const size = Math.min(canvasWidth, canvasHeight) * 0.8;
    const totalW = Math.max(1, Math.ceil(size + strokeWidth * 2));
    const totalH = Math.max(1, Math.ceil(size + strokeWidth * 2));
    const cx = totalW / 2;
    const cy = totalH / 2;
    const half = size / 2;

    const drawPolygon = (points: Array<{ x: number; y: number }>) => {
      const [first, ...rest] = points;
      if (!first) return;
      graphics.moveTo(first.x, first.y);
      for (const point of rest) {
        graphics.lineTo(point.x, point.y);
      }
      graphics.closePath();
    };

    if (type === 'square') {
      const w = ((config.width ?? 100) / 100) * size;
      const h = ((config.height ?? 100) / 100) * size;
      const r = ((config.cornerRadius ?? 0) / 100) * (Math.min(w, h) / 2);
      const x = cx - w / 2;
      const y = cy - h / 2;
      if (r > 0) {
        graphics.roundRect(x, y, w, h, r);
      } else {
        graphics.rect(x, y, w, h);
      }
    } else if (type === 'circle') {
      const sqX = (config.squashX ?? 0) / 100;
      const sqY = (config.squashY ?? 0) / 100;
      const rx = half * (1 - sqX);
      const ry = half * (1 - sqY);
      graphics.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry));
    } else if (type === 'triangle') {
      const baseLen = ((config.baseLength ?? 100) / 100) * size;
      const vOffsetRaw = (config.vertexOffset ?? 50) / 100;
      const vOffset = vOffsetRaw * baseLen;
      const topY = cy - half;
      const bottomY = cy + half;
      const leftX = cx - baseLen / 2;
      drawPolygon([
        { x: leftX + vOffset, y: topY },
        { x: leftX + baseLen, y: bottomY },
        { x: leftX, y: bottomY },
      ]);
    } else if (type === 'star') {
      const rays = config.rays ?? 5;
      const innerRadius = half * ((config.innerRadius ?? 40) / 100);
      const step = Math.PI / rays;
      const res = [];
      for (let i = 0; i < rays * 2; i++) {
        const radius = i % 2 === 0 ? half : innerRadius;
        const angle = i * step - Math.PI / 2;
        res.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
      }
      drawPolygon(res);
    } else if (type === 'bang') {
      const rays = config.rays ?? 12;
      const innerRadius = half * ((config.innerRadius ?? 70) / 100);
      const step = Math.PI / rays;
      const res = [];
      for (let i = 0; i < rays * 2; i++) {
        const radius = i % 2 === 0 ? half : innerRadius;
        const angle = i * step - Math.PI / 2;
        res.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
      }
      drawPolygon(res);
    } else if (type === 'cloud') {
      const cloudType = config.cloudType ?? 1;
      if (cloudType === 1) {
        graphics.circle(cx - half * 0.4, cy, half * 0.5);
        graphics.circle(cx + half * 0.4, cy, half * 0.5);
        graphics.circle(cx, cy - half * 0.3, half * 0.6);
        graphics.circle(cx, cy + half * 0.2, half * 0.4);
      } else {
        graphics.circle(cx - half * 0.5, cy + half * 0.1, half * 0.4);
        graphics.circle(cx + half * 0.5, cy + half * 0.1, half * 0.4);
        graphics.circle(cx - half * 0.2, cy - half * 0.3, half * 0.5);
        graphics.circle(cx + half * 0.2, cy - half * 0.2, half * 0.45);
        graphics.circle(cx, cy + half * 0.3, half * 0.3);
      }
    } else if (type === 'speech_bubble') {
      const w = ((config.width ?? 100) / 100) * size;
      const h = ((config.height ?? 70) / 100) * size;
      const x = cx - w / 2;
      const y = cy - h / 2 - half * 0.15;
      const r = Math.min(
        ((config.cornerRadius ?? 20) / 100) * (Math.min(w, h) / 2),
        Math.min(w, h) / 2,
      );
      const pointerDir = config.pointerDirection ?? 'left';
      const pointerXBase = w * ((config.pointerX ?? 30) / 100);
      const pointerWidth = w * ((config.pointerAngle ?? 20) / 100);
      const pointerHeight = h * ((config.pointerSharpness ?? 40) / 100);

      graphics.moveTo(x + r, y);
      graphics.lineTo(x + w - r, y);
      graphics.quadraticCurveTo(x + w, y, x + w, y + r);
      graphics.lineTo(x + w, y + h - r);
      graphics.quadraticCurveTo(x + w, y + h, x + w - r, y + h);

      if (pointerDir === 'right') {
        graphics.lineTo(x + pointerXBase + pointerWidth, y + h);
        graphics.lineTo(x + pointerXBase + pointerWidth, y + h + pointerHeight);
        graphics.lineTo(x + pointerXBase, y + h);
      } else {
        graphics.lineTo(x + pointerXBase + pointerWidth, y + h);
        graphics.lineTo(x + pointerXBase, y + h + pointerHeight);
        graphics.lineTo(x + pointerXBase, y + h);
      }

      graphics.lineTo(x + r, y + h);
      graphics.quadraticCurveTo(x, y + h, x, y + h - r);
      graphics.lineTo(x, y + r);
      graphics.quadraticCurveTo(x, y, x + r, y);
    } else {
      // Fallback: plain square
      graphics.rect(cx - half, cy - half, size, size);
    }

    graphics.fill(parseHexColor(fill));
    if (strokeWidth > 0) {
      graphics.stroke({ width: strokeWidth, color: parseHexColor(stroke) });
    }
  }
}
