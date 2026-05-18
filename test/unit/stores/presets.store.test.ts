/** @vitest-environment node */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { usePresetsStore } from '~/stores/presets.store';
import { registerEffect, getVideoEffectManifest, getAudioEffectManifest } from '~/effects';
import { registerTransition, getTransitionManifest } from '~/transitions';

const workspaceMock = {
  workspaceHandle: {} as any,
  workspaceState: {
    presets: {
      custom: [] as any[],
      defaultTextPresetId: '',
      collapsed: {} as Record<string, boolean>,
    },
  },
  batchUpdateWorkspaceState: vi.fn().mockImplementation((fn: any) => {
    fn(workspaceMock.workspaceState);
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
    workspaceMock.workspaceState.presets.custom = [];
    workspaceMock.workspaceState.presets.defaultTextPresetId = '';
    workspaceMock.workspaceState.presets.collapsed = {};
  });

  it('load restores presets from workspace state', () => {
    workspaceMock.workspaceState.presets.custom = [
      {
        id: 'p1',
        baseType: 'blur',
        name: 'My Blur',
        category: 'effect',
        params: { strength: 1 },
        order: 0,
      },
    ];
    workspaceMock.workspaceState.presets.defaultTextPresetId = 'p1';
    workspaceMock.workspaceState.presets.collapsed = { effectsStandardCollapsed: true };

    const store = usePresetsStore();
    store.load();

    expect(store.customPresets).toHaveLength(1);
    expect(store.customPresets[0].name).toBe('My Blur');
    expect(store.defaultTextPresetId).toBe('p1');
    expect(store.effectsStandardCollapsed).toBe(true);
    expect(vi.mocked(registerEffect)).toHaveBeenCalled();
  });

  it('saveAsPreset creates and registers a video effect preset', () => {
    const store = usePresetsStore();
    store.saveAsPreset('effect', 'blur', 'Strong Blur', { strength: 2 });

    expect(store.customPresets).toHaveLength(1);
    expect(store.customPresets[0].category).toBe('effect');
    expect(store.customPresets[0].effectTarget).toBe('video');
    expect(vi.mocked(registerEffect)).toHaveBeenCalled();
    expect(workspaceMock.batchUpdateWorkspaceState).toHaveBeenCalled();
  });

  it('saveAsPreset creates and registers an audio effect preset', () => {
    const store = usePresetsStore();
    store.saveAsPreset('effect', 'eq', 'Bass Boost', { gain: 6 }, 'audio');

    expect(store.customPresets[0].effectTarget).toBe('audio');
    expect(vi.mocked(registerEffect)).toHaveBeenCalled();
  });

  it('saveAsPreset creates and registers a transition preset', () => {
    const store = usePresetsStore();
    store.saveAsPreset('transition', 'dissolve', 'Slow Dissolve', { duration: 2 });

    expect(store.customPresets[0].category).toBe('transition');
    expect(vi.mocked(registerTransition)).toHaveBeenCalled();
  });

  it('updatePreset updates params and re-registers manifest', () => {
    const store = usePresetsStore();
    store.saveAsPreset('effect', 'blur', 'Strong Blur', { strength: 2 });
    const id = store.customPresets[0].id;

    vi.clearAllMocks();
    store.updatePreset(id, { strength: 3 });

    expect(store.customPresets[0].params).toEqual({ strength: 3 });
    expect(vi.mocked(registerEffect)).toHaveBeenCalled();
  });

  it('updatePresetsOrder reorders presets within a category', () => {
    const store = usePresetsStore();
    store.saveAsPreset('effect', 'blur', 'A', {});
    store.saveAsPreset('effect', 'blur', 'B', {});
    const [p1, p2] = store.customPresets;

    store.updatePresetsOrder('effect', [p2.id, p1.id]);

    expect(store.customPresets.map((p) => p.id)).toEqual([p2.id, p1.id]);
  });

  it('removePreset deletes a preset and persists', () => {
    const store = usePresetsStore();
    store.saveAsPreset('effect', 'blur', 'ToRemove', {});
    const id = store.customPresets[0].id;

    store.removePreset(id);

    expect(store.customPresets).toHaveLength(0);
    expect(workspaceMock.batchUpdateWorkspaceState).toHaveBeenCalled();
  });
});
