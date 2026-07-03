/** @vitest-environment node */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { usePresetsStore } from '~/stores/presets.store';
import { registerEffect } from '~/effects';
import { registerTransition } from '~/transitions';
import { InMemoryFileSystemAdapter } from '~/file-manager/core/vfs/adapters/InMemoryFileSystemAdapter';

const vfsMock = new InMemoryFileSystemAdapter();

vi.mock('~/composables/useVfs', () => ({
  useVfs: () => vfsMock,
}));

const workspaceMock = {
  workspaceHandle: {} as any,
  userSettings: {
    presets: {
      custom: [] as any[],
      defaultTextPresetId: '',
      collapsed: {} as Record<string, boolean>,
    },
    exportPresets: {
      selectedPresetId: 'optimal',
      items: [],
    },
  },
  batchUpdateUserSettings: vi.fn().mockImplementation((fn: any) => {
    fn(workspaceMock.userSettings);
  }),
};

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(() => workspaceMock),
}));

vi.mock('~/effects', () => ({
  registerEffect: vi.fn(),
  getVideoEffectManifest: vi.fn().mockReturnValue({
    type: 'blur',
    name: 'Blur',
    defaultValues: { strength: 0.5 },
  }),
  getAudioEffectManifest: vi.fn().mockReturnValue({
    type: 'eq',
    name: 'EQ',
    defaultValues: { gain: 0 },
  }),
}));

vi.mock('~/transitions', () => ({
  registerTransition: vi.fn(),
  getTransitionManifest: vi.fn().mockReturnValue({
    type: 'dissolve',
    name: 'Dissolve',
    defaultParams: { duration: 1 },
  }),
}));

describe('PresetsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    workspaceMock.userSettings.presets.custom = [];
    workspaceMock.userSettings.presets.defaultTextPresetId = '';
    workspaceMock.userSettings.presets.collapsed = {};
  });

  it('load restores presets from user settings and files', async () => {
    const store = usePresetsStore();
    await store.saveAsPreset('effect', 'blur', 'My Blur', { strength: 1 });

    workspaceMock.userSettings.presets.defaultTextPresetId = 'p1';
    workspaceMock.userSettings.presets.collapsed = { effectsStandardCollapsed: true };

    await store.load();

    expect(store.customPresets).toHaveLength(1);
    expect(store.customPresets[0].name).toBe('My Blur');
    expect(store.effectsStandardCollapsed).toBe(true);
    expect(vi.mocked(registerEffect)).toHaveBeenCalled();
  });

  it('saveAsPreset creates and registers a video effect preset', async () => {
    const store = usePresetsStore();
    await store.saveAsPreset('effect', 'blur', 'Strong Blur', { strength: 2 });

    expect(store.customPresets).toHaveLength(1);
    expect(store.customPresets[0].category).toBe('effect');
    expect(store.customPresets[0].effectTarget).toBe('video');
    expect(vi.mocked(registerEffect)).toHaveBeenCalled();
    expect(workspaceMock.batchUpdateUserSettings).toHaveBeenCalled();
  });

  it('saveAsPreset creates and registers an audio effect preset', async () => {
    const store = usePresetsStore();
    await store.saveAsPreset('effect', 'eq', 'Bass Boost', { gain: 6 }, 'audio');

    expect(store.customPresets[0].effectTarget).toBe('audio');
    expect(vi.mocked(registerEffect)).toHaveBeenCalled();
  });

  it('saveAsPreset creates and registers a transition preset', async () => {
    const store = usePresetsStore();
    await store.saveAsPreset('transition', 'dissolve', 'Slow Dissolve', { duration: 2 });

    expect(store.customPresets[0].category).toBe('transition');
    expect(vi.mocked(registerTransition)).toHaveBeenCalled();
  });

  it('updatePreset updates params and re-registers manifest', async () => {
    const store = usePresetsStore();
    await store.saveAsPreset('effect', 'blur', 'Strong Blur', { strength: 2 });
    const id = store.customPresets[0].id;

    vi.clearAllMocks();
    await store.updatePreset(id, { strength: 3 });

    expect(store.customPresets[0].params).toEqual({ strength: 3 });
    expect(vi.mocked(registerEffect)).toHaveBeenCalled();
  });

  it('updatePresetsOrder reorders presets within a category', async () => {
    const store = usePresetsStore();
    await store.saveAsPreset('effect', 'blur', 'A', {});
    await store.saveAsPreset('effect', 'blur', 'B', {});
    const [p1, p2] = store.customPresets;

    await store.updatePresetsOrder('effect', [p2.id, p1.id]);

    expect(store.customPresets.map((p) => p.id)).toEqual([p2.id, p1.id]);
  });

  it('removePreset deletes a preset and persists', async () => {
    const store = usePresetsStore();
    await store.saveAsPreset('effect', 'blur', 'ToRemove', {});
    const id = store.customPresets[0].id;

    await store.removePreset(id);

    expect(store.customPresets).toHaveLength(0);
  });
});
