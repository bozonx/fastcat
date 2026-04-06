import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactive } from 'vue';
import { mountWithNuxt } from '../../utils/mount';
import SelectEffectModal from '~/components/effects/SelectEffectModal.vue';

const mockPresetsStore = reactive({
  customPresets: [] as Array<{ id: string; category: string; effectTarget?: 'video' | 'audio' }>,
  effectsStandardCollapsed: false,
  audioStandardCollapsed: false,
  effectsCustomCollapsed: false,
});

const mockGetAllVideoEffectManifests = vi.fn();
const mockGetAllAudioEffectManifests = vi.fn();
const mockGetEffectManifest = vi.fn();

vi.mock('~/stores/presets.store', () => ({
  usePresetsStore: () => mockPresetsStore,
}));

vi.mock('~/effects', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/effects')>();

  return {
    ...actual,
    getAllVideoEffectManifests: () => mockGetAllVideoEffectManifests(),
    getAllAudioEffectManifests: () => mockGetAllAudioEffectManifests(),
    getEffectManifest: (id: string) => mockGetEffectManifest(id),
  };
});

vi.mock('~/components/ui/UiModal.vue', () => ({
  default: {
    name: 'UiModal',
    template:
      '<div class="mock-modal"><div class="modal-title">{{ title }}</div><slot /><slot name="footer" /></div>',
    props: ['open', 'title'],
  },
}));

vi.mock('~/components/effects/CollapsibleEffectGroup.vue', () => ({
  default: {
    name: 'CollapsibleEffectGroup',
    template: '<section class="effect-group"><h3>{{ title }}</h3><slot /></section>',
    props: ['title', 'isCollapsed'],
  },
}));

vi.mock('~/components/effects/EffectCard.vue', () => ({
  default: {
    name: 'EffectCard',
    template: '<button class="effect-card" @click="$emit(\'click\')">{{ manifest.type }}</button>',
    props: ['manifest'],
  },
}));

describe('SelectEffectModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPresetsStore.customPresets = [];
  });

  it('groups standard and custom effects correctly', async () => {
    mockGetAllVideoEffectManifests.mockReturnValue([
      { type: 'brightness', category: 'basic', isCustom: false },
      { type: 'reverb', category: 'artistic', isCustom: false },
      { type: 'ignore-custom-flag', category: 'basic', isCustom: true },
    ]);
    mockGetAllAudioEffectManifests.mockReturnValue([]);
    mockPresetsStore.customPresets = [
      { id: 'custom-glow', category: 'effect', effectTarget: 'video' },
    ];
    mockGetEffectManifest.mockReturnValue({
      type: 'custom-glow',
      category: 'basic',
      isCustom: true,
    });

    const component = await mountWithNuxt(SelectEffectModal, {
      props: {
        open: true,
        target: 'video',
      },
    });

    const groups = component.findAll('.effect-group');
    expect(groups).toHaveLength(3);
    expect(component.text()).toContain('brightness');
    expect(component.text()).toContain('reverb');
    expect(component.text()).toContain('custom-glow');

    await component.findAll('.effect-card')[0].trigger('click');
    expect(component.emitted('select')?.[0]).toEqual(['brightness']);
  });

  it('shows empty state when no effects are available', async () => {
    mockGetAllVideoEffectManifests.mockReturnValue([]);
    mockGetAllAudioEffectManifests.mockReturnValue([]);
    mockGetEffectManifest.mockReturnValue(null);

    const component = await mountWithNuxt(SelectEffectModal, {
      props: {
        open: true,
        target: 'audio',
      },
    });

    expect(component.findAll('.effect-group')).toHaveLength(0);
    expect(component.text()).toContain('fastcat.effects.empty');
  });
});
