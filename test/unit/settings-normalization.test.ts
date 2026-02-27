// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { normalizeUserSettings, normalizeWorkspaceSettings } from '../../src/utils/settings';
import { DEFAULT_HOTKEYS } from '../../src/utils/hotkeys/defaultHotkeys';

describe('settings normalization', () => {
  it('migrates openBehavior to openLastProjectOnStart', () => {
    const normalized = normalizeUserSettings({ openBehavior: 'show_project_picker' });
    expect(normalized.openLastProjectOnStart).toBe(false);
    expect(normalized.hotkeys).toBeDefined();
    expect(normalized.hotkeys.bindings).toBeDefined();
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
    expect(normalized.exportDefaults.width).toBe(1920);
    expect(normalized.exportDefaults.encoding.format).toBe('mp4');
    expect(normalized.hotkeys.bindings).toEqual({});
    expect(DEFAULT_HOTKEYS.bindings['general.deselect']).toEqual(['Backspace']);
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
});
