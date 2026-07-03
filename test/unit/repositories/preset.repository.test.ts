import { describe, it, expect, beforeEach } from 'vitest';
import { createPresetRepository } from '~/repositories/preset.repository';
import { InMemoryFileSystemAdapter } from '~/file-manager/core/vfs/adapters/InMemoryFileSystemAdapter';
import type { CustomPreset, ExportSettingsPreset } from '~/utils/settings/presets';
import { createDefaultUserSettings } from '~/utils/settings';

describe('PresetRepository', () => {
  let vfs: InMemoryFileSystemAdapter;

  beforeEach(() => {
    vfs = new InMemoryFileSystemAdapter();
  });

  it('saves and loads custom clip presets', async () => {
    const repo = createPresetRepository({ vfs });

    const effectPreset: CustomPreset = {
      id: 'custom_effect_1',
      baseType: 'blur',
      name: 'My Blur',
      category: 'effect',
      effectTarget: 'video',
      params: { radius: 15 },
      order: 0,
    };

    const textPreset: CustomPreset = {
      id: 'custom_text_1',
      baseType: 'text_default',
      name: 'My Title',
      category: 'text',
      params: { color: '#ff0000', fontSize: 32 },
      order: 0,
    };

    await repo.saveCustomPreset(effectPreset);
    await repo.saveCustomPreset(textPreset);

    const loaded = await repo.loadCustomPresets();
    expect(loaded).toHaveLength(2);
    expect(loaded.find((p) => p.id === 'custom_effect_1')).toEqual(effectPreset);
    expect(loaded.find((p) => p.id === 'custom_text_1')).toEqual(textPreset);
  });

  it('deletes custom clip presets', async () => {
    const repo = createPresetRepository({ vfs });

    const preset: CustomPreset = {
      id: 'custom_shape_1',
      baseType: 'rectangle',
      name: 'Red Box',
      category: 'shape',
      params: { fill: 'red' },
      order: 0,
    };

    await repo.saveCustomPreset(preset);
    let loaded = await repo.loadCustomPresets();
    expect(loaded).toHaveLength(1);

    await repo.deleteCustomPreset('custom_shape_1', 'shape');
    loaded = await repo.loadCustomPresets();
    expect(loaded).toHaveLength(0);
  });

  it('saves, loads, and deletes custom export presets', async () => {
    const repo = createPresetRepository({ vfs });

    const exportPreset: ExportSettingsPreset = {
      id: 'custom_export_4k',
      name: '4K Ultra MP4',
      format: 'mp4',
      videoCodec: 'avc1.640032',
      bitrateMbps: 45,
      excludeAudio: false,
      audioCodec: 'aac',
      audioBitrateKbps: 320,
      bitrateMode: 'variable',
      keyframeIntervalSec: 2,
      exportAlpha: false,
      fastStart: true,
    };

    await repo.saveExportPreset(exportPreset);

    let loaded = await repo.loadExportPresets();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual(exportPreset);

    await repo.deleteExportPreset('custom_export_4k');
    loaded = await repo.loadExportPresets();
    expect(loaded).toHaveLength(0);
  });

  it('migrates legacy presets embedded in userSettings to individual files', async () => {
    const repo = createPresetRepository({ vfs });

    const userSettings = createDefaultUserSettings();
    const legacyEffect: CustomPreset = {
      id: 'legacy_effect_1',
      baseType: 'sepia',
      name: 'Vintage Sepia',
      category: 'effect',
      params: { intensity: 0.8 },
      order: 0,
    };

    const legacyExport: ExportSettingsPreset = {
      id: 'legacy_export_custom',
      name: 'Custom WebM',
      format: 'webm',
      videoCodec: 'vp9',
      bitrateMbps: 12,
      excludeAudio: false,
      audioCodec: 'opus',
      audioBitrateKbps: 160,
      bitrateMode: 'variable',
      keyframeIntervalSec: 2,
      exportAlpha: false,
      fastStart: true,
    };

    userSettings.presets.custom = [legacyEffect];
    userSettings.exportPresets.items.push(legacyExport);

    const { migratedCustom, migratedExport } = await repo.migrateLegacyPresets(userSettings);

    expect(migratedCustom).toHaveLength(1);
    expect(migratedCustom[0]!.id).toBe('legacy_effect_1');
    expect(migratedExport).toHaveLength(1);
    expect(migratedExport[0]!.id).toBe('legacy_export_custom');

    const customOnDisk = await repo.loadCustomPresets();
    expect(customOnDisk.find((p) => p.id === 'legacy_effect_1')).toBeDefined();

    const exportOnDisk = await repo.loadExportPresets();
    expect(exportOnDisk.find((p) => p.id === 'legacy_export_custom')).toBeDefined();
  });
});
