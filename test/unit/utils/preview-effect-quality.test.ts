import { describe, expect, it } from 'vitest';
import {
  previewEffectQualityRenderScale,
  previewEffectQualityTapBudget,
  resolvePreviewEffectQuality,
  resolvePreviewRenderScale,
} from '~/utils/preview-effect-quality';

describe('preview effect quality', () => {
  it('keeps an explicit setting during playback (manual governs motion only)', () => {
    expect(resolvePreviewEffectQuality({ setting: 'low', isPlaying: true })).toBe('low');
    expect(resolvePreviewEffectQuality({ setting: 'high', isPlaying: true })).toBe('high');
  });

  it('forces ultra for export and for any still/paused frame', () => {
    expect(resolvePreviewEffectQuality({ setting: 'low', isExport: true })).toBe('ultra');
    expect(resolvePreviewEffectQuality({ setting: 'auto', isPlaying: false })).toBe('ultra');
    // A still frame ignores the manual playback quality and renders at full fidelity.
    expect(resolvePreviewEffectQuality({ setting: 'low', isPlaying: false })).toBe('ultra');
  });

  it('adapts auto playback to device and pixel throughput', () => {
    expect(
      resolvePreviewEffectQuality({
        setting: 'auto',
        isPlaying: true,
        isMobile: true,
        width: 640,
        height: 360,
        fps: 30,
      }),
    ).toBe('low');
    expect(
      resolvePreviewEffectQuality({
        setting: 'auto',
        isPlaying: true,
        width: 1920,
        height: 1080,
        fps: 30,
      }),
    ).toBe('medium');
    expect(
      resolvePreviewEffectQuality({
        setting: 'auto',
        isPlaying: true,
        width: 960,
        height: 540,
        fps: 30,
      }),
    ).toBe('high');
  });

  it('maps quality levels to bounded compute blur budgets', () => {
    expect(['low', 'medium', 'high', 'ultra'].map(previewEffectQualityTapBudget)).toEqual([
      8, 16, 32, 48,
    ]);
  });

  it('maps quality levels to monotonic render scales', () => {
    const scales = (['low', 'medium', 'high', 'ultra'] as const).map(
      previewEffectQualityRenderScale,
    );
    expect(scales).toEqual([0.5, 0.67, 0.85, 1]);
    // strictly increasing — higher quality never downscales more
    for (let i = 1; i < scales.length; i += 1) {
      expect(scales[i]).toBeGreaterThan(scales[i - 1]);
    }
  });

  describe('resolvePreviewRenderScale', () => {
    it('derives the scale from the quality tier in auto mode', () => {
      expect(resolvePreviewRenderScale({ quality: 'low', isPlaying: true })).toBe(0.5);
      expect(resolvePreviewRenderScale({ quality: 'high', isPlaying: true })).toBe(0.85);
    });

    it('pins a manual scale (clamped to full) during playback', () => {
      expect(resolvePreviewRenderScale({ quality: 'low', manualScale: 0.25, isPlaying: true })).toBe(
        0.25,
      );
      expect(resolvePreviewRenderScale({ quality: 'low', manualScale: 2, isPlaying: true })).toBe(1);
    });

    it('treats a non-positive manual scale as auto', () => {
      expect(resolvePreviewRenderScale({ quality: 'medium', manualScale: 0, isPlaying: true })).toBe(
        0.67,
      );
    });

    it('always renders at full resolution for export and still frames', () => {
      expect(
        resolvePreviewRenderScale({ quality: 'low', manualScale: 0.25, isExport: true }),
      ).toBe(1);
      expect(
        resolvePreviewRenderScale({ quality: 'low', manualScale: 0.25, isPlaying: false }),
      ).toBe(1);
    });
  });
});
