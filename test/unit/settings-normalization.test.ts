// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { normalizeUserSettings, normalizeWorkspaceSettings } from '../../src/utils/settings';
import { DEFAULT_HOTKEYS } from '../../src/utils/hotkeys/defaultHotkeys';

describe('settings normalization', () => {
  it('migrates openBehavior to openLastProjectOnStart', () => {
    const normalized = normalizeUserSettings({ openBehavior: 'show_project_picker' });
    expect(normalized.openLastProjectOnStart).toBe(false);
    expect(normalized.locale).toBe('en-US');
    expect(normalized.hotkeys).toBeDefined();
    expect(normalized.hotkeys.bindings).toBeDefined();
  });

  it('normalizes locale', () => {
    expect(normalizeUserSettings({ locale: 'ru-RU' }).locale).toBe('ru-RU');
    expect(normalizeUserSettings({ locale: 'ru' }).locale).toBe('ru-RU');
    expect(normalizeUserSettings({ locale: 'en' }).locale).toBe('en-US');
    expect(normalizeUserSettings({ locale: 'en-US' }).locale).toBe('en-US');
    expect(normalizeUserSettings({ locale: 'fr' }).locale).toBe('en-US');
  });

  it('normalizes stopFrames quality percent', () => {
    expect(
      normalizeUserSettings({ stopFrames: { qualityPercent: 85 } }).stopFrames.qualityPercent,
    ).toBe(85);
    expect(
      normalizeUserSettings({ stopFrames: { qualityPercent: 150 } }).stopFrames.qualityPercent,
    ).toBe(100);
    expect(
      normalizeUserSettings({ stopFrames: { qualityPercent: 0 } }).stopFrames.qualityPercent,
    ).toBe(85);
  });

  it('uses exportDefaults fallback when missing', () => {
    const normalized = normalizeUserSettings({ openLastProjectOnStart: true });
    expect(normalized.locale).toBe('en-US');
    expect(normalized.projectDefaults.width).toBe(1920);
    expect(normalized.exportDefaults.encoding.format).toBe('mp4');
    expect(normalized.hotkeys.bindings).toEqual({});
    expect(DEFAULT_HOTKEYS.bindings['general.deselect']).toEqual(['Escape']);
  });

  it('normalizes workspace limits', () => {
    const normalized = normalizeWorkspaceSettings({
      proxyStorageLimitBytes: '123',
      cacheStorageLimitBytes: 0,
      thumbnailsStorageLimitBytes: 42,
    });

    expect(normalized.proxyStorageLimitBytes).toBe(123);
    expect(normalized.cacheStorageLimitBytes).toBe(2 * 1024 * 1024 * 1024);
    expect(normalized.thumbnailsStorageLimitBytes).toBe(42);
  });

  it('normalizes mouse settings and falls back to defaults for invalid values', () => {
    const normalized = normalizeUserSettings({
      mouse: {
        timeline: {
          wheel: 'zoom_vertical',
          wheelShift: 'invalid_action',
          wheelSecondary: 'scroll_horizontal',
          wheelSecondaryShift: 'none',
          middleClick: 'invalid',
        },
        monitor: {
          wheel: 'scroll_vertical',
          wheelShift: 'invalid_action',
          middleClick: 'none',
        },
      },
    });

    expect(normalized.mouse.timeline.wheel).toBe('zoom_vertical');
    expect(normalized.mouse.timeline.wheelShift).toBe('scroll_horizontal');
    expect(normalized.mouse.timeline.wheelSecondary).toBe('scroll_horizontal');
    expect(normalized.mouse.timeline.wheelSecondaryShift).toBe('none');
    expect(normalized.mouse.timeline.middleClick).toBe('pan');

    expect(normalized.mouse.monitor.wheel).toBe('scroll_vertical');
    expect(normalized.mouse.monitor.wheelShift).toBe('scroll_horizontal');
    expect(normalized.mouse.monitor.middleClick).toBe('none');
  });
});
