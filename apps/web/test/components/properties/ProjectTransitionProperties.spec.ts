import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import ProjectTransitionProperties from '~/components/properties/ProjectTransitionProperties.vue';

const mockSaveAsPreset = vi.fn();
const mockCustomPresets = [
  { id: 'custom_dissolve', name: 'Saved Dissolve', category: 'transition', baseType: 'dissolve' },
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

const getTransitionManifestMock = vi.fn();
const normalizeTransitionParamsMock = vi.fn(() => ({}));

vi.mock('~/transitions', () => ({
  getTransitionManifest: (type: string) => getTransitionManifestMock(type),
  normalizeTransitionParams: (type: string) => normalizeTransitionParamsMock(type),
}));

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

const TransitionParamFieldsStub = {
  props: ['fields', 'params'],
  emits: ['update:param'],
  template:
    '<div class="param-fields"><button class="emit-update" @click="$emit(\'update:param\', \'amount\', 50)" /></div>',
};

const UiEmptyStateStub = {
  props: ['message', 'wrapperClass'],
  template: '<div class="empty-state">{{ message }}</div>',
};

describe('ProjectTransitionProperties', () => {
  const stubs = {
    ProjectPresetProperties: ProjectPresetPropertiesStub,
    TransitionParamFields: TransitionParamFieldsStub,
    UiEmptyState: UiEmptyStateStub,
  };

  it('renders param fields when manifest has paramFields', async () => {
    getTransitionManifestMock.mockReturnValue({
      type: 'dissolve',
      name: 'Dissolve',
      paramFields: [{ kind: 'slider', key: 'amount' }],
      defaultValues: { amount: 50 },
    });

    const component = await mountSuspended(ProjectTransitionProperties, {
      props: { transitionType: 'dissolve' },
      global: { stubs },
    });

    expect(component.find('.param-fields').exists()).toBe(true);
    expect(component.find('.empty-state').exists()).toBe(false);
  });

  it('renders empty state when manifest has no paramFields', async () => {
    getTransitionManifestMock.mockReturnValue({
      type: 'cut',
      name: 'Cut',
      paramFields: [],
      defaultValues: {},
    });

    const component = await mountSuspended(ProjectTransitionProperties, {
      props: { transitionType: 'cut' },
      global: { stubs },
    });

    expect(component.find('.param-fields').exists()).toBe(false);
    expect(component.find('.empty-state').exists()).toBe(true);
  });

  it('renders empty state when manifest is undefined', async () => {
    getTransitionManifestMock.mockReturnValue(undefined);

    const component = await mountSuspended(ProjectTransitionProperties, {
      props: { transitionType: 'unknown' },
      global: { stubs },
    });

    expect(component.find('.empty-state').exists()).toBe(true);
  });

  it('resolves custom manifest name from customPresets', async () => {
    getTransitionManifestMock.mockReturnValue({
      type: 'custom_dissolve',
      baseType: 'dissolve',
      isCustom: true,
      paramFields: [],
      defaultValues: {},
    });

    const component = await mountSuspended(ProjectTransitionProperties, {
      props: { transitionType: 'custom_dissolve' },
      global: { stubs },
    });

    const manifestProp = component.find('.ppp-stub').attributes('data-manifest-name');
    expect(manifestProp).toBe('Saved Dissolve');
  });
});
