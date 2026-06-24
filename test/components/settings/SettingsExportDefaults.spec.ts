import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountWithNuxt } from '../../utils/mount';
import { nextTick, ref } from 'vue';
import SettingsExportDefaults from '~/components/settings/SettingsExportDefaults.vue';
import { createDefaultExportPresets, type ExportSettingsPreset } from '~/utils/settings';

const mockPresets = createDefaultExportPresets();

const mockWorkspaceStore = {
  userSettings: {
    exportPresets: {
      ...mockPresets,
      selectedPresetId: 'optimal',
    },
  },
  flushSettingsSaves: vi.fn(),
};

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
}));

vi.mock('~/composables/useVideoCodecs', () => ({
  useVideoCodecs: vi.fn(() => ({
    videoCodecSupport: ref({}),
    isLoadingCodecSupport: ref(false),
    videoCodecOptions: ref([
      { value: 'avc1.640032', label: 'H.264 (High)', disabled: false },
      { value: 'vp09.00.10.08', label: 'VP9', disabled: false },
      { value: 'av01.0.05M.08', label: 'AV1', disabled: false },
    ]),
    loadCodecSupport: vi.fn(),
  })),
}));

vi.mock('~/composables/timeline/export/core/useExportCodecs', () => ({
  useExportCodecs: vi.fn(() => ({
    audioCodecSupport: ref({
      aac: true,
      opus: true,
      mp3: true,
      flac: true,
      pcm: true,
    }),
    loadCodecSupport: vi.fn(),
    isLoadingCodecSupport: ref(false),
  })),
}));

vi.mock('~/composables/timeline/export/core/useAudioCodecOptions', () => ({
  useAudioCodecOptions: vi.fn(() => ({
    audioCodecOptions: ref([
      { value: 'aac', label: 'AAC', disabled: false },
      { value: 'opus', label: 'Opus', disabled: false },
      { value: 'flac', label: 'FLAC', disabled: false },
      { value: 'pcm', label: 'WAV', disabled: false },
      { value: 'mp3', label: 'MP3', disabled: false },
    ]),
    loadCodecSupport: vi.fn(),
    isLoadingCodecSupport: ref(false),
  })),
}));

function resetPresets() {
  const defaults = createDefaultExportPresets();
  mockWorkspaceStore.userSettings.exportPresets.items = [...defaults.items];
  mockWorkspaceStore.userSettings.exportPresets.selectedPresetId = defaults.selectedPresetId;
}

describe('SettingsExportDefaults.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPresets();
  });

  it('renders preset list and editor for selected preset', async () => {
    const wrapper = await mountWithNuxt(SettingsExportDefaults, {
      props: { isActive: true },
    });

    const buttons = wrapper.findAll('button');
    const optimalButton = buttons.find((b) => b.text().includes('Optimal'));
    expect(optimalButton?.exists()).toBe(true);

    const socialButton = buttons.find((b) => b.text().includes('Social Media'));
    expect(socialButton?.exists()).toBe(true);
  });

  it('selects a preset when clicked', async () => {
    const wrapper = await mountWithNuxt(SettingsExportDefaults, {
      props: { isActive: true },
    });

    const buttons = wrapper.findAll('button');
    const socialButton = buttons.find((b) => b.text().includes('Social Media'));
    expect(socialButton?.exists()).toBe(true);

    await socialButton?.trigger('click');
    await nextTick();

    expect(mockWorkspaceStore.userSettings.exportPresets.selectedPresetId).toBe('social');
  });

  it('duplicates a preset', async () => {
    const wrapper = await mountWithNuxt(SettingsExportDefaults, {
      props: { isActive: true },
    });

    const buttons = wrapper.findAll('button');
    const duplicateButton = buttons.find((b) =>
      b.attributes('title')?.includes('common.duplicate'),
    );
    expect(duplicateButton?.exists()).toBe(true);

    await duplicateButton?.trigger('click');
    await nextTick();

    const newPreset = mockWorkspaceStore.userSettings.exportPresets.items.find(
      (p: ExportSettingsPreset) => p.name.includes('copy'),
    );
    expect(newPreset).toBeDefined();
    expect(mockWorkspaceStore.userSettings.exportPresets.selectedPresetId).toBe(newPreset?.id);
  });

  it('creates a new preset from the selected one', async () => {
    const wrapper = await mountWithNuxt(SettingsExportDefaults, {
      props: { isActive: true },
    });

    const buttons = wrapper.findAll('button');
    const addButton = buttons.find((b) => b.text().includes('common.add'));
    expect(addButton?.exists()).toBe(true);

    await addButton?.trigger('click');
    await nextTick();

    const newPreset = mockWorkspaceStore.userSettings.exportPresets.items.find(
      (p: ExportSettingsPreset) => p.name.includes('common.newPreset'),
    );
    expect(newPreset).toBeDefined();
    expect(mockWorkspaceStore.userSettings.exportPresets.selectedPresetId).toBe(newPreset?.id);
  });

  it('does not show delete button for built-in presets', async () => {
    mockWorkspaceStore.userSettings.exportPresets.selectedPresetId = 'optimal';

    const wrapper = await mountWithNuxt(SettingsExportDefaults, {
      props: { isActive: true },
    });

    const buttons = wrapper.findAll('button');
    const trashButtons = buttons.filter((b) => b.attributes('title')?.includes('common.delete'));
    expect(trashButtons.length).toBe(0);
  });

  it('shows delete button for custom presets and deletes after confirmation', async () => {
    const customPreset = {
      ...mockWorkspaceStore.userSettings.exportPresets.items[0],
      id: 'export-custom',
      name: 'My Custom Preset',
    };
    mockWorkspaceStore.userSettings.exportPresets.items.push(customPreset);
    mockWorkspaceStore.userSettings.exportPresets.selectedPresetId = customPreset.id;

    const wrapper = await mountWithNuxt(SettingsExportDefaults, {
      props: { isActive: true },
    });

    const buttons = wrapper.findAll('button');
    const trashButton = buttons.find((b) => b.attributes('title')?.includes('common.delete'));
    expect(trashButton?.exists()).toBe(true);

    await trashButton?.trigger('click');
    await nextTick();

    const modal = wrapper.findComponent({ name: 'UiConfirmModal' });
    expect(modal.exists()).toBe(true);

    await modal.vm.$emit('confirm');
    await nextTick();

    expect(
      mockWorkspaceStore.userSettings.exportPresets.items.some(
        (p: ExportSettingsPreset) => p.id === customPreset.id,
      ),
    ).toBe(false);
  });

  it('does not delete the last remaining preset', async () => {
    mockWorkspaceStore.userSettings.exportPresets.items = [
      mockWorkspaceStore.userSettings.exportPresets.items[0],
    ];
    mockWorkspaceStore.userSettings.exportPresets.selectedPresetId =
      mockWorkspaceStore.userSettings.exportPresets.items[0].id;

    const wrapper = await mountWithNuxt(SettingsExportDefaults, {
      props: { isActive: true },
    });

    const buttons = wrapper.findAll('button');
    const trashButton = buttons.find((b) => b.attributes('title')?.includes('common.delete'));
    expect(trashButton).toBeUndefined();
  });
});
