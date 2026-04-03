import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';

describe('UiWheelNumberInput', () => {
  it('renders correctly', async () => {
    const component = await mountSuspended(UiWheelNumberInput, {
      props: {
        modelValue: 42,
      },
    });

    expect(component.exists()).toBe(true);
    // UInput is used which may not have type="number" directly accessible
    expect(component.find('input').exists()).toBe(true);
  });

  it('emits update:modelValue when input changes', async () => {
    const component = await mountSuspended(UiWheelNumberInput, {
      props: {
        modelValue: 10,
      },
    });

    const input = component.find('input');
    await input.setValue('25');

    expect(component.emitted('update:modelValue')).toBeTruthy();
    // The clamped value should be emitted
    expect(component.emitted('update:modelValue')?.[0]?.[0]).toBe(25);
  });

  it('clamps value to min when input is below min', async () => {
    const component = await mountSuspended(UiWheelNumberInput, {
      props: {
        modelValue: 10,
        min: 5,
      },
    });

    const input = component.find('input');
    await input.setValue('2');

    expect(component.emitted('update:modelValue')).toBeTruthy();
    expect(component.emitted('update:modelValue')?.[0]?.[0]).toBe(5);
  });

  it('clamps value to max when input is above max', async () => {
    const component = await mountSuspended(UiWheelNumberInput, {
      props: {
        modelValue: 10,
        max: 15,
      },
    });

    const input = component.find('input');
    await input.setValue('20');

    expect(component.emitted('update:modelValue')).toBeTruthy();
    expect(component.emitted('update:modelValue')?.[0]?.[0]).toBe(15);
  });

  it('disables the input when disabled prop is true', async () => {
    const component = await mountSuspended(UiWheelNumberInput, {
      props: {
        modelValue: 10,
        disabled: true,
      },
    });

    const input = component.find('input');
    expect(input.attributes('disabled')).toBeDefined();
  });

  it('passes min, max, and step props to the input element', async () => {
    const component = await mountSuspended(UiWheelNumberInput, {
      props: {
        modelValue: 10,
        min: 0,
        max: 100,
        step: 5,
      },
    });

    const input = component.find('input');
    expect(input.attributes('min')).toBe('0');
    expect(input.attributes('max')).toBe('100');
    expect(input.attributes('step')).toBe('5');
  });
});
