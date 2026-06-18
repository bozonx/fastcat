/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_TIMELINE_FORMAT,
  normalizeTimelineFormat,
  createTimelineFormatFromProjectDefaults,
  getTimelineFormat,
  setTimelineFormat,
} from '~/timeline/format';
import { getResolutionPreset } from '~/utils/settings/helpers';

vi.mock('~/utils/settings/helpers', () => ({
  getResolutionPreset: vi.fn(() => ({
    resolutionFormat: '1080p',
    aspectRatio: '16:9',
    orientation: 'landscape',
    isCustomResolution: false,
  })),
}));

describe('DEFAULT_TIMELINE_FORMAT', () => {
  it('has expected default values', () => {
    expect(DEFAULT_TIMELINE_FORMAT.width).toBe(1920);
    expect(DEFAULT_TIMELINE_FORMAT.height).toBe(1080);
    expect(DEFAULT_TIMELINE_FORMAT.fps).toBe(25);
  });
});

describe('normalizeTimelineFormat', () => {
  it('returns default format for null input', () => {
    const result = normalizeTimelineFormat(null);
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
  });

  it('clamps dimensions to valid range', () => {
    const result = normalizeTimelineFormat({ width: 10000, height: -5 });
    expect(result.width).toBe(7680);
    expect(result.height).toBe(1);
  });

  it('preserves custom resolution flag', () => {
    const result = normalizeTimelineFormat({ isCustomResolution: true });
    expect(result.isCustomResolution).toBe(true);
  });

  it('rounds fps to 3 decimal places', () => {
    const result = normalizeTimelineFormat({ fps: 29.970001 });
    expect(result.fps).toBe(29.97);
  });

  it('sets useProjectSettings to true by default', () => {
    const result = normalizeTimelineFormat(null);
    expect(result.useProjectSettings).toBe(true);
  });

  it('preserves useProjectSettings flag if provided', () => {
    const result = normalizeTimelineFormat({ useProjectSettings: false });
    expect(result.useProjectSettings).toBe(false);
  });

  it('recomputes the resolution preset from geometry when preset fields are omitted', () => {
    // This is what updateProjectFormat relies on: passing new geometry without
    // preset fields must derive the preset from getResolutionPreset rather than
    // keep stale values (e.g. a portrait clip inheriting the old `landscape`).
    vi.mocked(getResolutionPreset).mockReturnValueOnce({
      resolutionFormat: '1080p',
      aspectRatio: '16:9',
      orientation: 'portrait',
      isCustomResolution: false,
    });
    const result = normalizeTimelineFormat({
      width: 1080,
      height: 1920,
      // Stale landscape preset fields explicitly cleared, as updateProjectFormat does.
      orientation: undefined,
      resolutionFormat: undefined,
      aspectRatio: undefined,
      isCustomResolution: undefined,
    });
    expect(result.orientation).toBe('portrait');
  });

  it('keeps a stale orientation when the caller leaves preset fields populated', () => {
    // The inverse contract: an explicit orientation always wins, which is exactly
    // why updateProjectFormat must NOT forward the project's old preset fields.
    const result = normalizeTimelineFormat({
      width: 1080,
      height: 1920,
      orientation: 'landscape',
    });
    expect(result.orientation).toBe('landscape');
  });
});

describe('createTimelineFormatFromProjectDefaults', () => {
  it('creates format with project defaults and useProjectSettings true', () => {
    const result = createTimelineFormatFromProjectDefaults({ width: 1280, height: 720 });
    expect(result.width).toBe(1280);
    expect(result.height).toBe(720);
    expect(result.settingsSource).toBe('projectDefaults');
    expect(result.useProjectSettings).toBe(true);
  });
});

describe('getTimelineFormat', () => {
  it('returns default format for null doc', () => {
    expect(getTimelineFormat(null)).toEqual(expect.objectContaining({ width: 1920, height: 1080 }));
  });

  it('extracts format from document metadata', () => {
    const doc: any = {
      timebase: { fps: 30 },
      metadata: { fastcat: { format: { width: 3840, height: 2160 } } },
    };
    const result = getTimelineFormat(doc);
    expect(result.width).toBe(3840);
    expect(result.height).toBe(2160);
    expect(result.fps).toBe(30);
  });
});

describe('setTimelineFormat', () => {
  it('updates document format and timebase', () => {
    const doc: any = {
      id: 'doc-1',
      timebase: { fps: 25 },
      metadata: { fastcat: {} },
    };
    const result = setTimelineFormat(doc, { width: 1280, height: 720, fps: 30 });
    expect(result.timebase.fps).toBe(30);
    expect(result.metadata.fastcat.format.width).toBe(1280);
    expect(result.metadata.fastcat.format.height).toBe(720);
  });
});
