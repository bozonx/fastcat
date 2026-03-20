import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import UiFpsInputWithPresets from '~/components/ui/editor/UiFpsInputWithPresets.vue';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';

describe('UiFpsInputWithPresets', () => {
  it('renders correctly', async () => {
    const component = await mountSuspended(UiFpsInputWithPresets, {
      props: {
        modelValue: 30,
      },
    });

    expect(component.exists()).toBe(true);

    // Verify UiWheelNumberInput is rendered and receives the correct value
    const wheelInput = component.findComponent(UiWheelNumberInput);
    expect(wheelInput.exists()).toBe(true);
    expect(wheelInput.props('modelValue')).toBe(30);
  });

  it('emits update:modelValue when UiWheelNumberInput emits an update', async () => {
    const component = await mountSuspended(UiFpsInputWithPresets, {
      props: {
        modelValue: 30,
      },
    });

    const wheelInput = component.findComponent(UiWheelNumberInput);

    // Simulate child component emitting update
    await wheelInput.vm.$emit('update:modelValue', 60);

    expect(component.emitted('update:modelValue')).toBeTruthy();
    expect(component.emitted('update:modelValue')?.[0]).toEqual([60]);
  });

  it('disables the inputs when disabled prop is true', async () => {
    const component = await mountSuspended(UiFpsInputWithPresets, {
      props: {
        modelValue: 24,
        disabled: true,
      },
    });

    // Check UiWheelNumberInput
    const wheelInput = component.findComponent(UiWheelNumberInput);
    expect(wheelInput.props('disabled')).toBe(true);

    // Check dropdown trigger button
    const button = component.find('button');
    expect(button.exists()).toBe(true);
    expect(button.attributes('disabled')).toBeDefined();
  });
});
