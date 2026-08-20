import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import ClipBackgroundProperties from '~/components/properties/clip/ClipBackgroundProperties.vue';

vi.mock('~/components/properties/PropertySection.vue', () => ({
  default: {
    props: ['title'],
    template: '<div class="section-mock"><h3>{{ title }}</h3><slot /></div>',
  },
}));

const stubs = {
  UiColorBlendPicker: {
    props: ['color', 'showAlpha', 'showBlendMode'],
    emits: ['update:color'],
    template:
      '<input type="color" class="color-picker-mock" :value="color" :data-show-alpha="showAlpha" :data-show-blend-mode="showBlendMode" @input="$emit(\'update:color\', $event.target.value)" />',
  },
};

describe('ClipBackgroundProperties', () => {
  it('renders section with color title', async () => {
    const component = await mountSuspended(ClipBackgroundProperties, {
      props: { clip: { backgroundColor: '#ff0000' } as any },
      global: { stubs },
    });

    expect(component.find('.section-mock').exists()).toBe(true);
  });

  it('passes background color into shared color picker without alpha', async () => {
    const component = await mountSuspended(ClipBackgroundProperties, {
      props: { clip: { backgroundColor: '#ff0000' } as any },
      global: { stubs },
    });

    const picker = component.find('.color-picker-mock');
    expect(picker.attributes('value')).toBe('#ff0000');
    expect(picker.attributes('data-show-alpha')).toBe('false');
    expect(picker.attributes('data-show-blend-mode')).toBe('false');
  });

  it('emits updateBackgroundColor when color changes', async () => {
    const component = await mountSuspended(ClipBackgroundProperties, {
      props: { clip: { backgroundColor: '#ff0000' } as any },
      global: { stubs },
    });

    await component.find('.color-picker-mock').setValue('#00ff00');

    expect(component.emitted('updateBackgroundColor')).toBeTruthy();
  });
});
