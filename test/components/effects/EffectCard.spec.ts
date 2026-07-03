import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import EffectCard from '~/components/effects/EffectCard.vue';

describe('EffectCard', () => {
  it('hides description for video effects', async () => {
    const wrapper = await mountSuspended(EffectCard, {
      props: {
        manifest: {
          type: 'blur',
          name: 'Blur',
          description: 'Blurs the image',
          target: 'video',
          icon: 'i-heroicons-sparkles',
        } as any,
      },
      global: {
        stubs: {
          UIcon: { template: '<span class="u-icon"></span>' },
          UButton: { template: '<button class="u-button"><slot /></button>' },
        },
      },
    });

    expect(wrapper.find('p').exists()).toBe(false);
  });

  it('renders description for audio effects', async () => {
    const wrapper = await mountSuspended(EffectCard, {
      props: {
        manifest: {
          type: 'reverb',
          name: 'Reverb',
          description: 'Simulates room acoustic',
          target: 'audio',
          icon: 'i-heroicons-speaker-wave',
        } as any,
      },
      global: {
        stubs: {
          UIcon: { template: '<span class="u-icon"></span>' },
          UButton: { template: '<button class="u-button"><slot /></button>' },
        },
      },
    });

    expect(wrapper.find('p').exists()).toBe(true);
    expect(wrapper.find('p').text()).toBe('Simulates room acoustic');
  });
});
