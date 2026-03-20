import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import UiButtonGroup from '~/components/ui/UiButtonGroup.vue';

describe('UiButtonGroup', () => {
  const defaultOptions = [
    { label: 'Option 1', value: 'opt1' },
    { label: 'Option 2', value: 'opt2' },
  ];

  it('renders correctly', async () => {
    const component = await mountSuspended(UiButtonGroup, {
      props: {
        modelValue: 'opt1',
        options: defaultOptions,
      },
    });

    expect(component.exists()).toBe(true);
    expect(component.text()).toContain('Option 1');
    expect(component.text()).toContain('Option 2');
    expect(component.classes()).toContain('inline-flex');
  });

  it('applies fluid class when prop is true', async () => {
    const component = await mountSuspended(UiButtonGroup, {
      props: {
        modelValue: 'opt1',
        options: defaultOptions,
        fluid: true,
      },
    });

    expect(component.classes()).toContain('w-full');
  });

  it('emits update:modelValue and change events when an option is clicked', async () => {
    const component = await mountSuspended(UiButtonGroup, {
      props: {
        modelValue: 'opt1',
        options: defaultOptions,
      },
    });

    const buttons = component.findAll('button');
    expect(buttons.length).toBe(2);

    await buttons[1].trigger('click');

    expect(component.emitted('update:modelValue')).toBeTruthy();
    expect(component.emitted('update:modelValue')![0]).toEqual(['opt2']);

    expect(component.emitted('change')).toBeTruthy();
    expect(component.emitted('change')![0]).toEqual(['opt2']);
  });
});
