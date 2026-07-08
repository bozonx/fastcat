// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  normalizeAppSettings,
  normalizeUserSettings,
  normalizeWorkspaceSettings,
} from '~/utils/settings';
import { normalizeLocale } from '~/utils/settings/normalizers/shared';
import { DEFAULT_HOTKEYS } from '~/utils/hotkeys/defaultHotkeys';

describe('settings normalization', () => {
  it('migrates openBehavior to openLastProjectOnStart', () => {
    const normalized = normalizeUserSettings({ openBehavior: 'show_project_picker' });
    expect(normalized.openLastProjectOnStart).toBe(false);
    expect(normalized.locale).toBe('en-US');
    expect(normalized.hotkeys).toBeDefined();
    expect(normalized.hotkeys.bindings).toBeDefined();
  });

  it('migrates proxyResolution to proxyMaxPixels', () => {
    expect(
      normalizeUserSettings({ optimization: { proxyResolution: '360p' } }).optimization
        .proxyMaxPixels,
    ).toBe(400_000);
    expect(
      normalizeUserSettings({ optimization: { proxyResolution: '1080p' } }).optimization
        .proxyMaxPixels,
    ).toBe(3_000_000);
  });

  it('normalizes proxyMaxPixels', () => {
    expect(
      normalizeUserSettings({ optimization: { proxyMaxPixels: 500_000 } }).optimization
        .proxyMaxPixels,
    ).toBe(500_000);
    expect(
      normalizeUserSettings({ optimization: { proxyMaxPixels: 50_000 } }).optimization
        .proxyMaxPixels,
    ).toBe(1_500_000); // min limit
    expect(
      normalizeUserSettings({ optimization: { proxyMaxPixels: 20_000_000 } }).optimization
        .proxyMaxPixels,
    ).toBe(1_500_000); // max limit
  });

  it('normalizes native monitor sync mode', () => {
    expect(
      normalizeUserSettings({ optimization: { nativeMonitorSyncMode: 'smooth' } }).optimization
        .nativeMonitorSyncMode,
    ).toBe('smooth');
    expect(
      normalizeUserSettings({ optimization: { nativeMonitorSyncMode: 'strict' } }).optimization
        .nativeMonitorSyncMode,
    ).toBe('strict');
    expect(
      normalizeUserSettings({ optimization: { nativeMonitorSyncMode: 'invalid' } }).optimization
        .nativeMonitorSyncMode,
    ).toBe('balanced');
  });

  it('normalizes native monitor frame cache settings', () => {
    expect(
      normalizeUserSettings({
        optimization: { nativeFrameCacheMode: 'custom', nativeFrameCacheCustomMb: 0 },
      }).optimization,
    ).toMatchObject({
      nativeFrameCacheMode: 'custom',
      nativeFrameCacheCustomMb: 0,
    });
    expect(
      normalizeUserSettings({
        optimization: { nativeFrameCacheMode: 'invalid', nativeFrameCacheCustomMb: 99999 },
      }).optimization,
    ).toMatchObject({
      nativeFrameCacheMode: 'auto',
      nativeFrameCacheCustomMb: 512,
    });
  });

  it('normalizes locale', () => {
    expect(normalizeUserSettings({ locale: 'ru-RU' }).locale).toBe('ru-RU');
    expect(normalizeUserSettings({ locale: 'ru' }).locale).toBe('ru-RU');
    expect(normalizeUserSettings({ locale: 'en' }).locale).toBe('en-US');
    expect(normalizeUserSettings({ locale: 'en-US' }).locale).toBe('en-US');
    expect(normalizeUserSettings({ locale: 'fr' }).locale).toBe('en-US');
  });

  describe('normalizeLocale helper', () => {
    it('maps short language codes to full BCP-47 tags used by i18n', () => {
      expect(normalizeLocale({ locale: 'en' })).toBe('en-US');
      expect(normalizeLocale({ locale: 'ru' })).toBe('ru-RU');
    });

    it('passes through already-tagged locales unchanged', () => {
      expect(normalizeLocale({ locale: 'en-US' })).toBe('en-US');
      expect(normalizeLocale({ locale: 'ru-RU' })).toBe('ru-RU');
    });

    it('falls back to the default locale for unsupported values', () => {
      expect(normalizeLocale({ locale: 'fr-FR' })).toBe('en-US');
      expect(normalizeLocale({ locale: 'de' })).toBe('en-US');
      expect(normalizeLocale({ locale: '' })).toBe('en-US');
      expect(normalizeLocale({})).toBe('en-US');
      expect(normalizeLocale({ locale: null })).toBe('en-US');
      expect(normalizeLocale({ locale: undefined })).toBe('en-US');
      expect(normalizeLocale({ locale: 123 })).toBe('en-US');
    });

    it('reads legacy "language" and "lang" keys when locale is missing', () => {
      expect(normalizeLocale({ language: 'ru' })).toBe('ru-RU');
      expect(normalizeLocale({ lang: 'en' })).toBe('en-US');
    });

    it('prefers explicit "locale" over fallback aliases', () => {
      expect(normalizeLocale({ locale: 'ru', language: 'en', lang: 'fr' })).toBe('ru-RU');
    });
  });

  it('normalizes stopFrames quality percent', () => {
    expect(
      normalizeUserSettings({ stopFrames: { qualityPercent: 85 } }).stopFrames.qualityPercent,
    ).toBe(85);
    expect(
      normalizeUserSettings({ stopFrames: { qualityPercent: 150 } }).stopFrames.qualityPercent,
    ).toBe(85);
    expect(
      normalizeUserSettings({ stopFrames: { qualityPercent: 0 } }).stopFrames.qualityPercent,
    ).toBe(85);
  });

  it('uses preset fallbacks when missing', () => {
    const normalized = normalizeUserSettings({ openLastProjectOnStart: true });
    expect(normalized.locale).toBe('en-US');
    expect(normalized.projectPresets.items[0]?.width).toBe(1920);
    expect(normalized.exportPresets.items[0]?.format).toBe('mkv');
    expect(normalized.hotkeys.bindings).toEqual({});
    expect(DEFAULT_HOTKEYS.bindings['general.deselect']).toEqual(['Escape']);
    expect(DEFAULT_HOTKEYS.bindings['general.copy']).toHaveLength(1);
    expect(DEFAULT_HOTKEYS.bindings['general.cut']).toHaveLength(1);
    expect(DEFAULT_HOTKEYS.bindings['general.paste']).toHaveLength(1);
  });

  it('normalizes app settings paths and limits', () => {
    const normalized = normalizeAppSettings({
      paths: {
        contentRootPath: '  /mnt/content  ',
        dataRootPath: '  /mnt/data  ',
        tempRootPath: '  /mnt/temp  ',
        proxiesRootPath: '  /mnt/proxies  ',
        ephemeralTmpRootPath: '  /mnt/system-tmp  ',
        placementMode: 'portable',
      },
    });

    expect(normalized.paths.contentRootPath).toBe('/mnt/content');
    expect(normalized.paths.dataRootPath).toBe('/mnt/data');
    expect(normalized.paths.tempRootPath).toBe('/mnt/temp');
    expect(normalized.paths.proxiesRootPath).toBe('/mnt/proxies');
    expect(normalized.paths.ephemeralTmpRootPath).toBe('/mnt/system-tmp');
    expect(normalized.paths.placementMode).toBe('portable');
  });

  it('keeps workspace normalization as a legacy alias for app settings', () => {
    const normalized = normalizeWorkspaceSettings({
      paths: {
        contentRootPath: '/workspace',
      },
    });

    expect(normalized.paths.contentRootPath).toBe('/workspace');
  });

  it('normalizes integration settings', () => {
    const normalized = normalizeUserSettings({
      integrations: {
        fastcatPublicador: {
          enabled: true,
          bearerToken: '  gp_token  ',
        },
        manualFilesApi: {
          enabled: true,
          baseUrl: 'https://files.example.com/api/',
          bearerToken: ' files-token ',
          overrideFastCat: 1,
        },
        stt: {
          provider: ' assemblyai ',
          models: [' universal-3-pro ', '', 'universal-2'],
          restorePunctuation: false,
          formatText: true,
          includeWords: false,
        },
      },
    });

    expect(normalized.integrations.fastcatPublicador.enabled).toBe(true);
    expect(normalized.integrations.fastcatPublicador.bearerToken).toBe('gp_token');

    expect(normalized.integrations.manualFilesApi.enabled).toBe(true);
    expect(normalized.integrations.manualFilesApi.baseUrl).toBe('https://files.example.com/api');
    expect(normalized.integrations.manualFilesApi.bearerToken).toBe('files-token');
    expect(normalized.integrations.manualFilesApi.overrideFastCat).toBe(true);

    expect(normalized.integrations.stt.provider).toBe('assemblyai');
    expect(normalized.integrations.stt.models).toEqual(['universal-3-pro', '', 'universal-2']);
    expect(normalized.integrations.stt.restorePunctuation).toBe(false);
    expect(normalized.integrations.stt.formatText).toBe(true);
    expect(normalized.integrations.stt.includeWords).toBe(false);
  });

  it('normalizes trackHeaders mouse fallbacks to real defaults', () => {
    const normalized = normalizeUserSettings({ mouse: { trackHeaders: {} } });
    expect(normalized.mouse.trackHeaders.click).toBe('select_track');
    expect(normalized.mouse.trackHeaders.middleClick).toBe('select_all_clips');
    expect(normalized.mouse.trackHeaders.doubleClick).toBe('select_all_clips');
  });

  it('normalizes mouse settings and falls back to defaults for invalid values', () => {
    const normalized = normalizeUserSettings({
      mouse: {
        ruler: {
          wheel: 'invalid_action',
          wheelShift: 'seek_second',
          wheelSecondary: 'zoom_horizontal',
          wheelSecondaryShift: 'invalid_action',
          middleClick: 'none',
          doubleClick: 'invalid_action',
        },
        timeline: {
          wheel: 'zoom_vertical',
          wheelShift: 'invalid_action',
          wheelSecondary: 'scroll_horizontal',
          wheelSecondaryShift: 'none',
          middleClick: 'invalid',
        },
        trackHeaders: {
          wheel: 'seek_frame',
          wheelShift: 'invalid_action',
          wheelSecondary: 'resize_track',
          wheelSecondaryShift: 'seek_second',
        },
        monitor: {
          wheel: 'scroll_vertical',
          wheelShift: 'invalid_action',
          middleClick: 'none',
          leftDoubleClick: 'reset_zoom_center',
          middleDoubleClick: 'center',
        },
      },
    });

    expect(normalized.mouse.ruler.wheel).toBe('seek_frame');
    expect(normalized.mouse.ruler.wheelShift).toBe('seek_second');
    expect(normalized.mouse.ruler.wheelSecondary).toBe('zoom_horizontal');
    expect(normalized.mouse.ruler.wheelSecondaryShift).toBe('zoom_horizontal_to_playhead');
    expect(normalized.mouse.ruler.middleClick).toBe('none');
    expect(normalized.mouse.ruler.doubleClick).toBe('add_marker');

    expect(normalized.mouse.timeline.wheel).toBe('zoom_vertical');
    expect(normalized.mouse.timeline.wheelShift).toBe('zoom_horizontal');
    expect(normalized.mouse.timeline.wheelSecondary).toBe('scroll_horizontal');
    expect(normalized.mouse.timeline.wheelSecondaryShift).toBe('none');
    expect(normalized.mouse.timeline.middleClick).toBe('fit_zoom');

    expect(normalized.mouse.trackHeaders.wheel).toBe('seek_frame');
    expect(normalized.mouse.trackHeaders.wheelShift).toBe('zoom_vertical');
    expect(normalized.mouse.trackHeaders.wheelSecondary).toBe('resize_track');
    expect(normalized.mouse.trackHeaders.wheelSecondaryShift).toBe('seek_second');

    expect(normalized.mouse.monitor.wheel).toBe('scroll_vertical');
    expect(normalized.mouse.monitor.wheelShift).toBe('scroll_horizontal');
    expect(normalized.mouse.monitor.middleClick).toBe('none');
    expect(normalized.mouse.monitor.leftDoubleClick).toBe('reset_zoom_center');
    expect(normalized.mouse.monitor.middleDoubleClick).toBe('center');
  });

  it('migrates legacy monitor double click to left double click', () => {
    const normalized = normalizeUserSettings({
      mouse: {
        monitor: {
          doubleClick: 'fit',
        },
      },
    });

    expect(normalized.mouse.monitor.leftDoubleClick).toBe('fit');
    expect(normalized.mouse.monitor.middleDoubleClick).toBe('fit');
  });

  it('normalizes playhead click snapping settings', () => {
    const normalized = normalizeUserSettings({
      timeline: {
        snapping: {
          playheadClick: true,
        },
      },
    });

    expect(normalized.timeline.snapping.playheadClick).toBe(true);
    expect(normalized.timeline.snapping.playhead).toBe(true);
  });

  it('normalizes experimental features flag', () => {
    expect(normalizeUserSettings({ experimentalFeatures: true }).experimentalFeatures).toBe(true);
    expect(normalizeUserSettings({ experimentalFeatures: false }).experimentalFeatures).toBe(false);
    expect(normalizeUserSettings({}).experimentalFeatures).toBe(false);
    expect(normalizeUserSettings({ experimentalFeatures: 'yes' }).experimentalFeatures).toBe(false);
  });

  it('normalizes UI settings including defaultAudioWaveformMode', () => {
    const normalized = normalizeUserSettings({
      ui: {
        interfaceScale: 16,
        clipThumbnailMode: 'edges',
        defaultAudioWaveformMode: 'full',
      },
    });

    expect(normalized.ui.interfaceScale).toBe(16);
    expect(normalized.ui.clipThumbnailMode).toBe('edges');
    expect(normalized.ui.defaultAudioWaveformMode).toBe('full');

    const normalizedFallback = normalizeUserSettings({
      ui: {
        defaultAudioWaveformMode: 'invalid_mode',
      },
    });
    expect(normalizedFallback.ui.defaultAudioWaveformMode).toBe('half');
  });

  it('normalizes backup settings', () => {
    // Default values
    const def = normalizeUserSettings({});
    expect(def.backup.enabled).toBe(true);
    expect(def.backup.count).toBe(5);

    // Explicit valid configuration
    const valid = normalizeUserSettings({ backup: { enabled: false, count: 3 } });
    expect(valid.backup.enabled).toBe(false);
    expect(valid.backup.count).toBe(3);

    // Legacy migration (count = 0 means disabled)
    const legacy = normalizeUserSettings({ backup: { count: 0 } });
    expect(legacy.backup.enabled).toBe(false);
    expect(legacy.backup.count).toBe(5); // Reset to default count

    // Invalid counts (should fallback to default count 5)
    const invalid = normalizeUserSettings({ backup: { count: -10 } });
    expect(invalid.backup.count).toBe(5);
  });
});
