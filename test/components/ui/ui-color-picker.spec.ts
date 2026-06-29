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

  it('keeps selected outline after model value changes', async () => {
    const component = await mountSuspended(UiColorPicker, {
      props: { modelValue: '#ffffff', mode: 'marker' },
    });

    await component.setProps({ modelValue: '#eab308' });

    const selectedButtons = component
      .findAll('button')
      .filter((button) => button.attributes('data-selected') === 'true');

    expect(selectedButtons).toHaveLength(1);
    expect(selectedButtons[0]!.classes()).toContain('ring-2');
    expect(selectedButtons[0]!.text()).toContain('✓');
  });

  it('applies ring class to default marker yellow color', async () => {
    const component = await mountSuspended(UiColorPicker, {
      props: { modelValue: '#eab308', mode: 'marker' },
    });

    const buttons = component.findAll('button');
    const yellowButton = buttons.find((btn) => {
      const bg = btn.element.style.backgroundColor;
      return bg === 'rgb(234, 179, 8)' || bg === '#eab308';
    });

    expect(yellowButton).toBeDefined();
    expect(yellowButton!.classes()).toContain('ring-2');
    expect(yellowButton!.text()).toContain('✓');
  });
});
