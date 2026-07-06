import { describe, expect, it } from 'vitest';
import { DEFAULT_USER_SETTINGS, normalizeUserSettings } from '~/utils/settings';

describe('audio plugin user settings', () => {
  it('uses CLAP-only disabled defaults', () => {
    const settings = normalizeUserSettings({});

    expect(settings.audioPlugins).toEqual(DEFAULT_USER_SETTINGS.audioPlugins);
  });

  it('normalizes formats and scan paths', () => {
    const settings = normalizeUserSettings({
      audioPlugins: {
        enabled: true,
        scanOnStartup: true,
        enabledFormats: ['clap', 'bogus', 'clap', 'vst3'],
        customScanPaths: ['/plugins', '', '/plugins', '  /more-plugins  '],
      },
    });

    expect(settings.audioPlugins).toEqual({
      enabled: true,
      scanOnStartup: true,
      enabledFormats: ['clap', 'vst3'],
      customScanPaths: ['/plugins', '/more-plugins'],
    });
  });
});
