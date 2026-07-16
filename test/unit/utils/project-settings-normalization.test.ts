// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { normalizeProjectSettings } from '~/utils/project-settings';
import { createDefaultUserSettings } from '~/utils/settings';
import { TICKS_PER_MILLISECOND } from '~/utils/time';

describe('project settings normalization', () => {
  it('clamps numeric fields to reasonable bounds', () => {
    const user = createDefaultUserSettings();

    const normalized = normalizeProjectSettings(
      {
        project: {
          width: 1920,
          height: 1080,
          fps: 25,
          resolutionFormat: '1080p',
          orientation: 'landscape',
          aspectRatio: '16:9',
          isCustomResolution: false,
          sampleRate: 999999,
        },
        monitors: {
          cut: {
            previewResolution: 99999,
            useProxy: true,
            previewEffectsEnabled: false,
            panX: 0,
            panY: 0,
          },
        },
        timelines: {
          openPaths: [],
          lastOpenedPath: null,
        },
        transitions: {
          defaultDurationTicks: 2_000_000,
        },
      },
      user,
    );

    expect(normalized.project.sampleRate).toBe(48000);
    // Out-of-range previewResolution falls back to the default, which is now 0 ("auto":
    // derive the preview scale from the quality tier).
    expect(normalized.monitor.previewResolution).toBe(0);
    expect(normalized.monitor.previewEffectsEnabled).toBe(false);
  });

  it('migrates the retired "ultra" preview quality to "high"', () => {
    const user = createDefaultUserSettings();

    const normalized = normalizeProjectSettings(
      {
        project: { width: 1920, height: 1080, fps: 30 },
        monitors: { cut: { previewBlurQuality: 'ultra' } },
      },
      user,
    );

    expect(normalized.monitor.previewBlurQuality).toBe('high');
  });

  it('migrates legacy project duration settings from microseconds', () => {
    const user = createDefaultUserSettings();
    const normalized = normalizeProjectSettings(
      {
        project: { audioDeclickDurationTicks: 5_000 },
        transitions: { defaultDurationTicks: 2_000_000 },
      },
      user,
    );

    expect(normalized.project.audioDeclickDurationTicks).toBe(5 * TICKS_PER_MILLISECOND);
    expect(normalized.transitions.defaultDurationTicks).toBe(2_000 * TICKS_PER_MILLISECOND);
  });
});
