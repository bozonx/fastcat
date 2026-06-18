/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  getResolutionPreset,
  applyResolutionPreset,
  createDefaultUserSettings,
} from '~/utils/settings/helpers';
import { DEFAULT_USER_SETTINGS } from '~/utils/settings/defaults';

describe('createDefaultUserSettings', () => {
  it('creates isolated copies that do not mutate DEFAULT_USER_SETTINGS', () => {
    const defaults = createDefaultUserSettings();

    // Mutate nested objects that were previously shallow-copied
    defaults.timeline.snapping.clips = false;
    defaults.timeline.snapping.playhead = false;
    defaults.presets.custom.push({
      id: 'x',
      baseType: 'effect',
      name: 'Test',
      category: 'effect',
      params: {},
      order: 0,
    });
    defaults.presets.collapsed['test'] = true;

    // The DEFAULT_USER_SETTINGS must remain untouched
    expect(DEFAULT_USER_SETTINGS.timeline.snapping.clips).toBe(true);
    expect(DEFAULT_USER_SETTINGS.timeline.snapping.playhead).toBe(true);
    expect(DEFAULT_USER_SETTINGS.presets.custom).toEqual([]);
    expect(DEFAULT_USER_SETTINGS.presets.collapsed).toEqual({});
  });
});

describe('getResolutionPreset', () => {
  it('detects standard 1080p landscape', () => {
    const result = getResolutionPreset(1920, 1080);
    expect(result.resolutionFormat).toBe('1080p');
    expect(result.orientation).toBe('landscape');
    expect(result.aspectRatio).toBe('16:9');
    expect(result.isCustomResolution).toBe(false);
  });

  it('detects standard 720p landscape', () => {
    const result = getResolutionPreset(1280, 720);
    expect(result.resolutionFormat).toBe('720p');
    expect(result.orientation).toBe('landscape');
  });

  it('detects 4k landscape', () => {
    const result = getResolutionPreset(3840, 2160);
    expect(result.resolutionFormat).toBe('4k');
    expect(result.orientation).toBe('landscape');
  });

  it('detects portrait orientation', () => {
    const result = getResolutionPreset(1080, 1920);
    expect(result.resolutionFormat).toBe('1080p');
    expect(result.orientation).toBe('portrait');
    expect(result.aspectRatio).toBe('16:9');
  });

  it('marks non-standard resolution as custom', () => {
    const result = getResolutionPreset(1000, 500);
    expect(result.isCustomResolution).toBe(true);
    expect(result.resolutionFormat).toBe('1080p');
  });

  it('detects 4:3 aspect ratio', () => {
    const result = getResolutionPreset(800, 600);
    expect(result.aspectRatio).toBe('4:3');
  });

  it('detects 1:1 aspect ratio', () => {
    const result = getResolutionPreset(500, 500);
    expect(result.aspectRatio).toBe('1:1');
  });

  it('detects 21:9 aspect ratio', () => {
    const result = getResolutionPreset(2100, 900);
    expect(result.aspectRatio).toBe('21:9');
  });
});

describe('applyResolutionPreset', () => {
  it('overwrites stale preset fields from the geometry (landscape -> portrait)', () => {
    // The exact bug class: a landscape format whose geometry was swapped to
    // portrait must end up `portrait`, never keep the old `landscape`.
    const result = applyResolutionPreset({
      width: 1080,
      height: 1920,
      fps: 30,
      resolutionFormat: '1080p',
      orientation: 'landscape',
      aspectRatio: '16:9',
      isCustomResolution: false,
    });
    expect(result.orientation).toBe('portrait');
    expect(result.resolutionFormat).toBe('1080p');
    expect(result.aspectRatio).toBe('16:9');
    expect(result.isCustomResolution).toBe(false);
  });

  it('flags non-standard geometry as custom', () => {
    const result = applyResolutionPreset({ width: 1000, height: 500 });
    expect(result.isCustomResolution).toBe(true);
    expect(result.orientation).toBe('landscape');
  });

  it('preserves non-geometry fields untouched', () => {
    const result = applyResolutionPreset({ width: 3840, height: 2160, fps: 60, sampleRate: 44100 });
    expect(result.fps).toBe(60);
    expect(result.sampleRate).toBe(44100);
    expect(result.resolutionFormat).toBe('4k');
  });
});
