import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import ProjectEffectProperties from '~/components/properties/ProjectEffectProperties.vue';

const mockSaveAsPreset = vi.fn();
const mockCustomPresets = [
  { id: 'custom_blur', name: 'Saved Blur', category: 'effect', baseType: 'blur', target: 'video' },
];

vi.mock('~/stores/presets.store', () => ({
  usePresetsStore: () => ({
    customPresets: mockCustomPresets,
    saveAsPreset: mockSaveAsPreset,
  }),
}));

vi.mock('~/stores/selection.store', () => ({
  useSelectionStore: () => ({ clearSelection: vi.fn() }),
}));

vi.mock('~/utils/clone', () => ({
  cloneValue: (v: unknown) => (v && typeof v === 'object' ? { ...v } : v),
}));

const getEffectManifestMock = vi.fn();

vi.mock('~/effects', () => ({
  getEffectManifest: (type: string) => getEffectManifestMock(type),
}));

// Stub children. ProjectPresetProperties forwards v-models + save/rename events.
const ProjectPresetPropertiesStub = {
  props: ['manifest', 'actions', 'saveOpen', 'renameOpen', 'newName', 'renamingName'],
  emits: [
    'update:saveOpen',
    'update:renameOpen',
    'update:newName',
    'update:renamingName',
    'save',
    'rename',
  ],
  template: '<div class="ppp-stub" :data-manifest-name="manifest?.name"><slot /></div>',
};

const ParamsRendererStub = {
  props: ['controls', 'values'],
  emits: ['update:value'],
  template:
    '<div class="params-renderer"><button class="emit-update" @click="$emit(\'update:value\', \'radius\', 10)" /></div>',
};

const UiEmptyStateStub = {
  props: ['message', 'wrapperClass'],
  template: '<div class="empty-state">{{ message }}</div>',
};

describe('ProjectEffectProperties', () => {
  const stubs = {
    ProjectPresetProperties: ProjectPresetPropertiesStub,
    ParamsRenderer: ParamsRendererStub,
    UiEmptyState: UiEmptyStateStub,
  };

  it('renders params when manifest has controls', async () => {
    getEffectManifestMock.mockReturnValue({
      type: 'blur',
      name: 'Blur',
      controls: [{ kind: 'slider', key: 'radius' }],
      defaultValues: { radius: 5 },
    });

    const component = await mountSuspended(ProjectEffectProperties, {
      props: { effectType: 'blur' },
      global: { stubs },
    });

    expect(component.find('.params-renderer').exists()).toBe(true);
    expect(component.find('.empty-state').exists()).toBe(false);
  });

  it('renders empty state when manifest has no controls', async () => {
    getEffectManifestMock.mockReturnValue({
      type: 'noop',
      name: 'No-op',
      controls: [],
      defaultValues: {},
    });

    const component = await mountSuspended(ProjectEffectProperties, {
      props: { effectType: 'noop' },
      global: { stubs },
    });

    expect(component.find('.params-renderer').exists()).toBe(false);
    expect(component.find('.empty-state').exists()).toBe(true);
  });

  it('renders empty state when manifest is undefined', async () => {
    getEffectManifestMock.mockReturnValue(undefined);

    const component = await mountSuspended(ProjectEffectProperties, {
      props: { effectType: 'unknown' },
      global: { stubs },
    });

    expect(component.find('.empty-state').exists()).toBe(true);
  });

  it('resolves custom manifest name from customPresets', async () => {
    getEffectManifestMock.mockReturnValue({
      type: 'custom_blur',
      baseType: 'blur',
      isCustom: true,
      controls: [],
      defaultValues: {},
    });

    const component = await mountSuspended(ProjectEffectProperties, {
      props: { effectType: 'custom_blur' },
      global: { stubs },
    });

    const manifestProp = component.find('.ppp-stub').attributes('data-manifest-name');
    expect(manifestProp).toBe('Saved Blur');
  });
});
