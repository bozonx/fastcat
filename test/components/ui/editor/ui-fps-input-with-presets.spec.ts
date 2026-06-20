import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import UiFpsInputWithPresets from '~/components/ui/editor/UiFpsInputWithPresets.vue';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';
import UiSelect from '~/components/ui/UiSelect.vue';

vi.mock('~/components/ui/UiSelect.vue', () => ({
  default: {
    name: 'UiSelect',
    props: ['modelValue', 'items', 'disabled', 'valueKey', 'labelKey', 'searchInput'],
    template: `
      <select :value="modelValue" @change="$emit('update:modelValue', Number($event.target.value)); $emit('update:model-value', Number($event.target.value))">
        <option v-for="item in items" :key="item[valueKey]" :value="item[valueKey]">
          {{ item[labelKey] }}
        </option>
      </select>
    `,
  },
}));

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
    });

    // Check UiWheelNumberInput
    const wheelInput = component.findComponent(UiWheelNumberInput);
    expect(wheelInput.props('disabled')).toBe(true);

    // Check UiSelect
    const select = component.findComponent(UiSelect);
    expect(select.exists()).toBe(true);
    expect(select.props('disabled')).toBe(true);
  });

  it('renders UiSelect with fps presets and current value', async () => {
    const component = await mountSuspended(UiFpsInputWithPresets, {
      props: {
        modelValue: 30,
      },
    });

    const select = component.findComponent(UiSelect);
    expect(select.exists()).toBe(true);
    expect(select.props('modelValue')).toBe(30);
    expect(select.props('items')).toHaveLength(8);
    expect(select.props('valueKey')).toBe('value');
    expect(select.props('labelKey')).toBe('label');
  });

  it('emits update:modelValue when UiSelect emits an update', async () => {
    const component = await mountSuspended(UiFpsInputWithPresets, {
      props: {
        modelValue: 30,
      },
    });

    const select = component.findComponent(UiSelect);
    await select.vm.$emit('update:modelValue', 60);

    expect(component.emitted('update:modelValue')).toBeTruthy();
    expect(component.emitted('update:modelValue')?.[0]).toEqual([60]);
  });
});
