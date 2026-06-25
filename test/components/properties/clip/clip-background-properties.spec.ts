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
  UColorPicker: {
    props: ['modelValue', 'format', 'size'],
    emits: ['update:modelValue'],
    template:
      '<input type="color" class="color-picker-mock" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
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

  it('displays background color value', async () => {
    const component = await mountSuspended(ClipBackgroundProperties, {
      props: { clip: { backgroundColor: '#ff0000' } as any },
      global: { stubs },
    });

    expect(component.text()).toContain('#ff0000');
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
