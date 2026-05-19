/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  normalizeProjectPresetItem,
  normalizeExportPresetItem,
} from '~/utils/settings/normalizers/presets';
import {
  createDefaultProjectPresets,
  createDefaultExportPresets,
} from '~/utils/settings/presets';

describe('normalizeProjectPresetItem', () => {
  it('returns fallback for empty input', () => {
    const fallback = createDefaultProjectPresets().items[0]!;
    const result = normalizeProjectPresetItem({}, fallback);
    expect(result.id).toBe(fallback.id);
    expect(result.width).toBe(fallback.width);
  });

  it('applies custom width and height and resolves resolution preset', () => {
    const fallback = createDefaultProjectPresets().items[0]!;
    const result = normalizeProjectPresetItem({ width: 3840, height: 2160 }, fallback);
    expect(result.width).toBe(3840);
    expect(result.height).toBe(2160);
    expect(result.resolutionFormat).toBe('4k');
  });

  it('clamps fps to valid range', () => {
    const fallback = createDefaultProjectPresets().items[0]!;
    const result = normalizeProjectPresetItem({ fps: 300 }, fallback);
    expect(result.fps).toBe(fallback.fps);
  });
});

describe('normalizeExportPresetItem', () => {
  it('returns fallback for empty input', () => {
    const fallback = createDefaultExportPresets().items[0]!;
    const result = normalizeExportPresetItem({}, fallback);
    expect(result.id).toBe(fallback.id);
  });

  it('applies custom bitrate within limits', () => {
    const fallback = createDefaultExportPresets().items[0]!;
    const result = normalizeExportPresetItem({ bitrateMbps: 10 }, fallback);
    expect(result.bitrateMbps).toBe(10);
  });

  it('clamps bitrate to max', () => {
    const fallback = createDefaultExportPresets().items[0]!;
    const result = normalizeExportPresetItem({ bitrateMbps: 300 }, fallback);
    expect(result.bitrateMbps).toBe(fallback.bitrateMbps);
  });
});
