import { describe, expect, it } from 'vitest';
import {
  previewEffectQualityTapBudget,
  resolvePreviewEffectQuality,
} from '~/utils/preview-effect-quality';

describe('preview effect quality', () => {
  it('keeps an explicit setting during playback and while paused', () => {
    expect(resolvePreviewEffectQuality({ setting: 'low', isPlaying: true })).toBe('low');
    expect(resolvePreviewEffectQuality({ setting: 'low', isPlaying: false })).toBe('low');
  });

  it('forces ultra for export and paused auto preview', () => {
    expect(resolvePreviewEffectQuality({ setting: 'low', isExport: true })).toBe('ultra');
    expect(resolvePreviewEffectQuality({ setting: 'auto', isPlaying: false })).toBe('ultra');
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
});
