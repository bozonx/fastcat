import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import EffectsEditor from '~/components/effects/EffectsEditor.vue';

vi.mock('vue-draggable-plus', () => ({
  VueDraggable: {
    template: '<div class="mock-draggable"><slot /></div>',
    props: ['modelValue'],
  },
}));

vi.mock('~/components/effects/SelectEffectModal.vue', () => ({
  default: { template: '<div class="mock-select-effect"></div>', props: ['open'] },
}));
vi.mock('~/components/properties/ParamsRenderer.vue', () => ({
  default: { template: '<div class="mock-params-renderer"></div>' },
}));
vi.mock('~/components/ui/UiModal.vue', () => ({
  default: {
    template: '<div class="mock-modal"><slot name="body" /><slot /></div>',
    props: ['open'],
  },
}));

const mockPresetsStore = {
  saveAsPreset: vi.fn(),
};

vi.mock('~/stores/presets.store', () => ({
  usePresetsStore: () => mockPresetsStore,
}));

vi.mock('~/effects', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    getVideoEffectManifest: (type: string) => {
      if (type === 'blur')
        return { name: 'Blur Effect', type: 'blur', defaultValues: { radius: 5 }, controls: [] };
      return null;
    },
  };
});

describe('EffectsEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const sampleEffects = [
    { id: 'eff-1', type: 'blur', target: 'video', enabled: true, radius: 10 } as any,
  ];

  it('renders correctly with empty effects', async () => {
    const component = await mountSuspended(EffectsEditor, {
      props: { effects: [] },
    });

    expect(component.text()).toContain('fastcat.effects.empty');
  });

  it('renders correctly with effects', async () => {
    const component = await mountSuspended(EffectsEditor, {
      props: { effects: sampleEffects },
    });

    expect(component.text()).toContain('Blur Effect');
    const toggle = component.findComponent({ name: 'USwitch' });
    expect(toggle.exists()).toBe(true);
  });

  it('emits update:effects when removing an effect', async () => {
    const component = await mountSuspended(EffectsEditor, {
      props: { effects: sampleEffects },
    });

    const buttons = component.findAllComponents({ name: 'UButton' });
    const trashBtn = buttons.find(
      (b) => b.props('icon') === 'i-heroicons-trash' || b.props('color') === 'red',
    );

    if (trashBtn) {
      trashBtn.vm.$emit('click');
    } else {
      // Fallback to DOM button if UButton is rendered directly
      const domBtns = component.findAll('button');
      const domTrashBtn = domBtns.find((b) => b.html().includes('trash'));
      await domTrashBtn!.trigger('click');
    }

    expect(component.emitted('update:effects')).toBeTruthy();
    expect(component.emitted('update:effects')![0][0]).toEqual([]);
  });
});
