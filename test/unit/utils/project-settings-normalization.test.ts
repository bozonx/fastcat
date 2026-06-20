// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { normalizeProjectSettings } from '~/utils/project-settings';
import { createDefaultUserSettings } from '~/utils/settings';

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
          defaultDurationUs: 2_000_000,
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
});
