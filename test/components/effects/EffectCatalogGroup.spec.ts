import { describe, expect, it, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import EffectCatalogGroup from '~/components/effects/EffectCatalogGroup.vue';

vi.mock('vue-draggable-plus', () => ({
  VueDraggable: {
    name: 'VueDraggable',
    props: ['modelValue'],
    template: '<div><slot /></div>',
  },
}));

vi.mock('~/components/effects/CollapsibleEffectGroup.vue', () => ({
  default: {
    name: 'CollapsibleEffectGroup',
    template: '<section><slot /></section>',
  },
}));

describe('EffectCatalogGroup', () => {
  it('adds stable select test ids to effect cards', async () => {
    const wrapper = await mountSuspended(EffectCatalogGroup, {
      props: {
        title: 'Standard',
        draggable: false,
        items: [
          {
            type: 'color-adjustment',
            name: 'Color Correction',
            target: 'video',
          },
        ],
      },
      global: {
        stubs: {
          UIcon: { template: '<span />' },
          UButton: { template: '<button><slot /></button>' },
        },
      },
    });

    expect(wrapper.get('[data-testid="select-effect-color-adjustment"]').exists()).toBe(true);
  });
});
