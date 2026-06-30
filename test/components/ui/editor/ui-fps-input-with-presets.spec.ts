import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import UiFpsInputWithPresets from '~/components/ui/editor/UiFpsInputWithPresets.vue';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';

const dropdownStub = {
  name: 'UDropdownMenu',
  props: ['items', 'disabled', 'ui'],
  template: '<div class="mock-dropdown" :data-disabled="disabled"><slot /></div>',
};

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

  it('handles fractional FPS values without rounding to two decimals', async () => {
    const component = await mountSuspended(UiFpsInputWithPresets, {
      props: {
        modelValue: 23.976,
      },
    });

    const wheelInput = component.findComponent(UiWheelNumberInput);
    expect(wheelInput.exists()).toBe(true);
    expect(wheelInput.props('modelValue')).toBe(23.976);
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
      global: {
        stubs: { UDropdownMenu: dropdownStub },
      },
    });

    // Check UiWheelNumberInput
    const wheelInput = component.findComponent(UiWheelNumberInput);
    expect(wheelInput.props('disabled')).toBe(true);

    // Check UDropdownMenu is disabled
    const dropdown = component.findComponent({ name: 'UDropdownMenu' });
    expect(dropdown.exists()).toBe(true);
    expect(dropdown.props('disabled')).toBe(true);
  });

  it('renders UDropdownMenu with fps presets', async () => {
    const component = await mountSuspended(UiFpsInputWithPresets, {
      props: {
        modelValue: 30,
      },
      global: {
        stubs: { UDropdownMenu: dropdownStub },
      },
    });

    const dropdown = component.findComponent({ name: 'UDropdownMenu' });
    expect(dropdown.exists()).toBe(true);
    expect(dropdown.props('items')).toHaveLength(8);
    expect(dropdown.props('items')[0].label).toBe('23.976');
    expect(dropdown.props('items')[7].label).toBe('60');
  });

  it('emits update:modelValue when dropdown preset is selected', async () => {
    const component = await mountSuspended(UiFpsInputWithPresets, {
      props: {
        modelValue: 30,
      },
      global: {
        stubs: { UDropdownMenu: dropdownStub },
      },
    });

    const dropdown = component.findComponent({ name: 'UDropdownMenu' });
    const items = dropdown.props('items');
    // Select the last preset (60 fps)
    items[7].onSelect();

    expect(component.emitted('update:modelValue')).toBeTruthy();
    expect(component.emitted('update:modelValue')?.[0]).toEqual([60]);
  });
});
