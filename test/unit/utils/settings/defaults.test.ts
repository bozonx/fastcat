/** @vitest-environment node */
import { timelineUs } from '../timeline-time';
import { describe, it, expect } from 'vitest';
import { DEFAULT_USER_SETTINGS, DEFAULT_APP_SETTINGS } from '~/utils/settings/defaults';

describe('DEFAULT_USER_SETTINGS', () => {
  it('has default locale', () => {
    expect(DEFAULT_USER_SETTINGS.locale).toBe('en-US');
  });

  it('has timeline defaults', () => {
    expect(DEFAULT_USER_SETTINGS.timeline.snapThresholdPx).toBe(8);
    expect(DEFAULT_USER_SETTINGS.timeline.defaultAudioFadeDurationUs).toBe(timelineUs(1_000_000));
    expect(DEFAULT_USER_SETTINGS.timeline.defaultTransitionDurationUs).toBe(timelineUs(2_000_000));
  });

  it('has hotkey defaults', () => {
    expect(DEFAULT_USER_SETTINGS.hotkeys.layer1).toBe('Shift');
    expect(DEFAULT_USER_SETTINGS.hotkeys.layer2).toBe('Control');
  });

  it('has project defaults', () => {
    expect(DEFAULT_USER_SETTINGS.projectDefaults.width).toBe(1920);
    expect(DEFAULT_USER_SETTINGS.projectDefaults.height).toBe(1080);
    expect(DEFAULT_USER_SETTINGS.projectDefaults.fps).toBe(25);
    expect(DEFAULT_USER_SETTINGS.projectDefaults.defaultAudioFadeCurve).toBe('linear');
  });

  it('uses balanced native monitor sync by default', () => {
    expect(DEFAULT_USER_SETTINGS.optimization.nativeMonitorSyncMode).toBe('balanced');
  });

  it('uses automatic native frame cache by default', () => {
    expect(DEFAULT_USER_SETTINGS.optimization.nativeFrameCacheMode).toBe('auto');
    expect(DEFAULT_USER_SETTINGS.optimization.nativeFrameCacheCustomMb).toBe(512);
  });

  it('has mouse defaults', () => {
    expect(DEFAULT_USER_SETTINGS.mouse.timeline.click).toBe('select_item');
    expect(DEFAULT_USER_SETTINGS.mouse.ruler.click).toBe('seek');
    expect(DEFAULT_USER_SETTINGS.mouse.monitor.leftDoubleClick).toBe('fullscreen');
    expect(DEFAULT_USER_SETTINGS.mouse.monitor.middleDoubleClick).toBe('fit');
  });

  it('has experimental features disabled by default', () => {
    expect(DEFAULT_USER_SETTINGS.experimentalFeatures).toBe(false);
  });
});

describe('DEFAULT_APP_SETTINGS', () => {
  it('has empty paths', () => {
    expect(DEFAULT_APP_SETTINGS.paths.contentRootPath).toBe('');
    expect(DEFAULT_APP_SETTINGS.paths.dataRootPath).toBe('');
  });
});
