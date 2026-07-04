import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountWithNuxt } from '../../utils/mount';
import { reactive, computed } from 'vue';
import ProjectEffects from '~/components/project/ProjectEffects.vue';

const armPointerDndMock = vi.fn();

const mockSelectionStore = reactive({
  selectedEntity: null,
  selectProjectEffect: vi.fn(),
  selectProjectTransition: vi.fn(),
});

const mockPresetsStore = reactive({
  effectsStandardCollapsed: false,
  effectsCustomCollapsed: false,
  transitionsStandardCollapsed: false,
  transitionsCustomCollapsed: false,
  audioStandardCollapsed: false,
  audioCustomCollapsed: false,
  customPresets: [],
  removePreset: vi.fn(),
  updatePresetsOrder: vi.fn(),
});

const mockWorkspaceStore = reactive({
  inDevelopmentFeaturesEnabled: computed(() => false),
});

vi.mock('~/stores/selection.store', () => ({ useSelectionStore: () => mockSelectionStore }));
vi.mock('~/stores/presets.store', () => ({ usePresetsStore: () => mockPresetsStore }));
vi.mock('~/stores/workspace.store', () => ({ useWorkspaceStore: () => mockWorkspaceStore }));

vi.mock('~/effects', () => ({
  getAllVideoEffectManifests: vi.fn(() => [
    {
      type: 'blur',
      name: 'Blur',
      icon: 'i-heroicons-sparkles',
      target: 'video',
      defaultValues: {},
    },
  ]),
  getAllAudioEffectManifests: vi.fn(() => []),
  getEffectManifest: vi.fn(() => null),
}));

vi.mock('~/transitions', () => ({
  getAllTransitionManifests: vi.fn(() => [
    {
      type: 'fade',
      name: 'Fade',
      icon: 'i-heroicons-arrows-right-left',
    },
  ]),
  getTransitionManifest: vi.fn(() => null),
}));

vi.mock('vue-draggable-plus', () => ({
  VueDraggable: {
    name: 'VueDraggable',
    template: '<div><slot /></div>',
  },
}));

vi.mock('~/components/effects/CollapsibleEffectGroup.vue', () => ({
  default: { name: 'CollapsibleEffectGroup', template: '<div><slot /></div>' },
}));

vi.mock('~/components/effects/EffectCard.vue', () => ({
  default: {
    name: 'EffectCard',
    emits: ['pointer-down', 'click'],
    template: '<div class="effect-card" @pointerdown="$emit(\'pointer-down\', $event)" />',
  },
}));

vi.mock('~/composables/dnd/usePointerDnd', () => ({
  armPointerDnd: (...args: unknown[]) => armPointerDndMock(...args),
}));

describe('ProjectEffects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspaceStore.inDevelopmentFeaturesEnabled = computed(() => false);
  });

  it('hides the audio effects tab when in-development features are disabled', async () => {
    const component = await mountWithNuxt(ProjectEffects);

    const tabs = component.findAll('button');
    const audioTab = tabs.find((tab) => tab.text().toLowerCase().includes('audio'));
    expect(audioTab).toBeUndefined();
  });

  it('shows the audio effects tab when in-development features are enabled', async () => {
    mockWorkspaceStore.inDevelopmentFeaturesEnabled = computed(() => true);

    const component = await mountWithNuxt(ProjectEffects);

    const tabs = component.findAll('button');
    const audioTab = tabs.find((tab) => tab.text().toLowerCase().includes('audio'));
    expect(audioTab).toBeDefined();
  });

  it('arms pointer-DnD for video effects', async () => {
    const component = await mountWithNuxt(ProjectEffects);
    const firstCard = component.find('.effect-card');

    await firstCard.trigger('pointerdown', { button: 0 });

    expect(armPointerDndMock).toHaveBeenCalledTimes(1);
    const [, options] = armPointerDndMock.mock.calls[0] as [PointerEvent, { payload: any }];
    expect(options.payload.source).toBe('effect');
    expect(options.payload.data.type).toBe('blur');
  });
});
