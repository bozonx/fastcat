import { describe, it, expect, vi } from 'vitest';
import {
  clamp,
  frequencyToX,
  gainToY,
  getPointContribution,
  drawParametricEqVisualization,
  EQ_MIN_FREQUENCY,
  EQ_MAX_FREQUENCY,
  EQ_MIN_GAIN,
  EQ_MAX_GAIN,
  EQ_CANVAS_WIDTH,
  EQ_CANVAS_HEIGHT,
} from '~/utils/eq/parametric-eq-render';

describe('parametric-eq-render', () => {
  describe('clamp', () => {
    it('returns value when inside range', () => {
      expect(clamp(5, 0, 10)).toBe(5);
    });

    it('returns min when below range', () => {
      expect(clamp(-5, 0, 10)).toBe(0);
    });

    it('returns max when above range', () => {
      expect(clamp(15, 0, 10)).toBe(10);
    });
  });

  describe('frequencyToX', () => {
    it('maps min frequency to 0', () => {
      expect(frequencyToX(EQ_MIN_FREQUENCY)).toBe(0);
    });

    it('maps max frequency to canvas width', () => {
      expect(frequencyToX(EQ_MAX_FREQUENCY)).toBe(EQ_CANVAS_WIDTH);
    });

    it('returns a value between 0 and canvas width for mid frequency', () => {
      const x = frequencyToX(1000);
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(EQ_CANVAS_WIDTH);
    });
  });

  describe('gainToY', () => {
    it('maps min gain to canvas height', () => {
      expect(gainToY(EQ_MIN_GAIN)).toBe(EQ_CANVAS_HEIGHT);
    });

    it('maps max gain to 0', () => {
      expect(gainToY(EQ_MAX_GAIN)).toBe(0);
    });

    it('maps 0 gain to middle of canvas', () => {
      expect(gainToY(0)).toBe(EQ_CANVAS_HEIGHT / 2);
    });
  });

  describe('getPointContribution', () => {
    it('returns 0 for disabled point', () => {
      const result = getPointContribution({ enabled: false, type: 'peaking', frequency: 1000, q: 1, gain: 6 }, 1000);
      expect(result).toBe(0);
    });

    it('returns gain at center frequency for peaking', () => {
      const result = getPointContribution({ enabled: true, type: 'peaking', frequency: 1000, q: 1, gain: 6 }, 1000);
      expect(result).toBeCloseTo(6, 0);
    });

    it('returns 0 for allpass', () => {
      const result = getPointContribution({ enabled: true, type: 'allpass', frequency: 1000, q: 1, gain: 6 }, 1000);
      expect(result).toBe(0);
    });

    it('attenuates lowpass above frequency', () => {
      const result = getPointContribution({ enabled: true, type: 'lowpass', frequency: 1000, q: 1, gain: 6 }, 2000);
      expect(result).toBeLessThan(0);
    });

    it('returns 0 for lowpass below frequency', () => {
      const result = getPointContribution({ enabled: true, type: 'lowpass', frequency: 1000, q: 1, gain: 6 }, 500);
      expect(result).toBe(0);
    });
  });

  describe('drawParametricEqVisualization', () => {
    it('calls canvas getContext and drawing methods', () => {
      const clearRect = vi.fn();
      const fillRect = vi.fn();
      const beginPath = vi.fn();
      const moveTo = vi.fn();
      const lineTo = vi.fn();
      const stroke = vi.fn();
      const arc = vi.fn();
      const fill = vi.fn();
      const fillText = vi.fn();

      const mockContext = {
        clearRect,
        fillRect,
        beginPath,
        moveTo,
        lineTo,
        stroke,
        arc,
        fill,
        fillText,
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        font: '',
        textAlign: '',
        textBaseline: '',
      } as unknown as CanvasRenderingContext2D;

      const canvas = {
        getContext: vi.fn(() => mockContext),
      } as unknown as HTMLCanvasElement;

      drawParametricEqVisualization({
        canvas,
        points: [{ enabled: true, type: 'peaking', frequency: 1000, q: 1, gain: 6 }],
      });

      expect(canvas.getContext).toHaveBeenCalledWith('2d');
      expect(clearRect).toHaveBeenCalled();
      expect(fillRect).toHaveBeenCalled();
      expect(beginPath).toHaveBeenCalled();
      expect(stroke).toHaveBeenCalled();
    });

    it('returns early when getContext returns null', () => {
      const canvas = {
        getContext: vi.fn(() => null),
      } as unknown as HTMLCanvasElement;

      expect(() =>
        drawParametricEqVisualization({
          canvas,
          points: [],
        })
      ).not.toThrow();

      expect(canvas.getContext).toHaveBeenCalledWith('2d');
    });
  });
});
