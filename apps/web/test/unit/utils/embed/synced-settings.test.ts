/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  applySyncedSettings,
  extractSyncedSettings,
  EMBED_SETTINGS_SCHEMA_VERSION,
} from '~/utils/embed/synced-settings';
import { DEFAULT_USER_SETTINGS } from '~/utils/settings/defaults';
import type { FastCatUserSettings } from '~/utils/settings/defaults';

function freshSettings(): FastCatUserSettings {
  return structuredClone(DEFAULT_USER_SETTINGS);
}

describe('extractSyncedSettings', () => {
  it('carries deliberate choices and leaves session-local state behind', () => {
    const settings = freshSettings();
    settings.timeline.snapThresholdPx = 21;
    settings.presets.custom = [{ id: 'p1' } as never];
    settings.presets.collapsed = { group: true };

    const snapshot = extractSyncedSettings(settings);

    expect(snapshot.version).toBe(EMBED_SETTINGS_SCHEMA_VERSION);
    expect(snapshot.values.timeline?.snapThresholdPx).toBe(21);
    expect(snapshot.values.presets?.custom).toHaveLength(1);
    // Collapsed state is a view detail, not a preference worth a round trip.
    expect(snapshot.values.presets).not.toHaveProperty('collapsed');
    // Integrations hold host credentials and must never leave the editor.
    expect(snapshot.values).not.toHaveProperty('integrations');
    expect(snapshot.values).not.toHaveProperty('backup');
  });

  it('produces a detached, structured-cloneable snapshot', () => {
    const settings = freshSettings();
    const snapshot = extractSyncedSettings(settings);

    settings.timeline.snapThresholdPx = 999;
    expect(snapshot.values.timeline?.snapThresholdPx).not.toBe(999);
    expect(() => structuredClone(snapshot)).not.toThrow();
  });
});

describe('applySyncedSettings', () => {
  it('restores stored values onto defaults', () => {
    const source = freshSettings();
    source.timeline.snapThresholdPx = 17;
    source.deleteWithoutConfirmation = true;
    const snapshot = extractSyncedSettings(source);

    const target = freshSettings();
    expect(applySyncedSettings(target, snapshot)).toBe(true);
    expect(target.timeline.snapThresholdPx).toBe(17);
    expect(target.deleteWithoutConfirmation).toBe(true);
  });

  it('keeps defaults for keys an older payload never knew about', () => {
    const target = freshSettings();
    const applied = applySyncedSettings(target, {
      version: 1,
      values: { timeline: { snapThresholdPx: 3 } },
    });

    expect(applied).toBe(true);
    expect(target.timeline.snapThresholdPx).toBe(3);
    expect(target.timeline.snapping.clips).toBe(DEFAULT_USER_SETTINGS.timeline.snapping.clips);
  });

  it('refuses a payload written by a newer editor', () => {
    const target = freshSettings();
    const applied = applySyncedSettings(target, {
      version: EMBED_SETTINGS_SCHEMA_VERSION + 1,
      values: { timeline: { snapThresholdPx: 3 } },
    });

    expect(applied).toBe(false);
    expect(target.timeline.snapThresholdPx).toBe(DEFAULT_USER_SETTINGS.timeline.snapThresholdPx);
  });

  it('ignores junk instead of throwing', () => {
    const target = freshSettings();
    expect(applySyncedSettings(target, null)).toBe(false);
    expect(applySyncedSettings(target, 'nope')).toBe(false);
    expect(applySyncedSettings(target, { version: 1 })).toBe(false);
  });
});
