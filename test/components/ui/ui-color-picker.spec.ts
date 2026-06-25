import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import UiColorPicker from '~/components/ui/UiColorPicker.vue';

describe('UiColorPicker', () => {
  it('renders color buttons in track mode', async () => {
    const component = await mountSuspended(UiColorPicker, {
      props: { modelValue: '#ff0000', mode: 'track' },
    });

    expect(component.exists()).toBe(true);
    const buttons = component.findAll('button');
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('renders color buttons in marker mode', async () => {
    const component = await mountSuspended(UiColorPicker, {
      props: { modelValue: '#ffffff', mode: 'marker' },
    });

    const buttons = component.findAll('button');
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('emits update:modelValue when a color is clicked', async () => {
    const component = await mountSuspended(UiColorPicker, {
      props: { modelValue: '#ffffff', mode: 'track' },
    });

    const firstButton = component.find('button');
    await firstButton.trigger('click');

    expect(component.emitted('update:modelValue')).toBeTruthy();
  });

  it('applies ring class to selected color', async () => {
    const component = await mountSuspended(UiColorPicker, {
      props: { modelValue: '#ffffff', mode: 'marker' },
    });

    const selectedButton = component.find('button');
    expect(selectedButton.classes()).toContain('ring-2');
  });

  it('renders grid with 5 columns', async () => {
    const component = await mountSuspended(UiColorPicker, {
      props: { modelValue: '#ffffff', mode: 'track' },
    });

    expect(component.find('.grid-cols-5').exists()).toBe(true);
  });
});
