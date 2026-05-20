/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  createDefaultProjectPresets,
  createDefaultExportPresets,
  resolveProjectPreset,
  resolveLastUsedProjectPreset,
  resolveExportPreset,
  createProjectPresetId,
  createExportPresetId,
} from '~/utils/settings/presets';

describe('createDefaultProjectPresets', () => {
  it('returns presets with default selected', () => {
    const presets = createDefaultProjectPresets();
    expect(presets.items.length).toBeGreaterThan(0);
    expect(presets.selectedPresetId).toBe('fhd-25-desktop');
    expect(presets.lastUsedPresetId).toBe('fhd-25-desktop');
  });
});

describe('createDefaultExportPresets', () => {
  it('returns presets with optimal selected', () => {
    const presets = createDefaultExportPresets();
    expect(presets.items.length).toBeGreaterThan(0);
    expect(presets.selectedPresetId).toBe('optimal');
  });
});

describe('resolveProjectPreset', () => {
  it('returns default preset for null input', () => {
    const preset = resolveProjectPreset(null);
    expect(preset.id).toBe('fhd-25-desktop');
  });

  it('returns preset matching selectedPresetId', () => {
    const preset = resolveProjectPreset({
      selectedPresetId: 'fhd-30-desktop',
      items: createDefaultProjectPresets().items,
    });
    expect(preset.id).toBe('fhd-30-desktop');
  });

  it('falls back to first preset if id not found', () => {
    const preset = resolveProjectPreset({
      selectedPresetId: 'unknown',
      items: createDefaultProjectPresets().items,
    });
    expect(preset.id).toBe('fhd-25-desktop');
  });
});

describe('resolveLastUsedProjectPreset', () => {
  it('prefers lastUsedPresetId', () => {
    const preset = resolveLastUsedProjectPreset({
      lastUsedPresetId: 'fhd-30-mobile',
      selectedPresetId: 'fhd-25-desktop',
      items: createDefaultProjectPresets().items,
    });
    expect(preset.id).toBe('fhd-30-mobile');
  });

  it('falls back to selectedPresetId when lastUsed is missing', () => {
    const preset = resolveLastUsedProjectPreset({
      selectedPresetId: 'fhd-30-desktop',
      items: createDefaultProjectPresets().items,
    });
    expect(preset.id).toBe('fhd-30-desktop');
  });
});

describe('resolveExportPreset', () => {
  it('returns default preset for null input', () => {
    const preset = resolveExportPreset(null);
    expect(preset.id).toBe('optimal');
  });

  it('returns preset matching selectedPresetId', () => {
    const preset = resolveExportPreset({
      selectedPresetId: 'social',
      items: createDefaultExportPresets().items,
    });
    expect(preset.id).toBe('social');
  });
});

describe('preset ID generators', () => {
  it('createProjectPresetId returns project- prefixed string', () => {
    const id = createProjectPresetId();
    expect(id).toMatch(/^project-[a-z0-9]+$/);
  });

  it('createExportPresetId returns export- prefixed string', () => {
    const id = createExportPresetId();
    expect(id).toMatch(/^export-[a-z0-9]+$/);
  });
});
