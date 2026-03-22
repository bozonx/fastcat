import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import UiSliderInput from '~/components/ui/UiSliderInput.vue';

describe('UiSliderInput', () => {
  it('renders correctly with default props', async () => {
    const component = await mountSuspended(UiSliderInput, {
      props: {
        modelValue: 50,
        min: 0,
        max: 100,
      },
    });

    expect(component.exists()).toBe(true);
    const input = component.find('input[type="number"]');
    expect(input.exists()).toBe(true);
    // Default has 2 decimals but number input might show '50'
    expect((input.element as HTMLInputElement).value).toBe('50');
  });

  it('renders label instead of input when label prop is provided', async () => {
    const component = await mountSuspended(UiSliderInput, {
      props: {
        modelValue: 50,
        min: 0,
        max: 100,
        label: 'Opacity',
      },
    });

    expect(component.text()).toContain('Opacity');
    const input = component.find('input[type="number"]');
    expect(input.exists()).toBe(false);
  });

  it('displays the custom formattedValue when provided', async () => {
    const component = await mountSuspended(UiSliderInput, {
      props: {
        modelValue: 50,
        min: 0,
        max: 100,
        formattedValue: 'Half',
        label: 'Progress',
      },
    });

    expect(component.text()).toContain('Half');
    expect(component.text()).not.toContain('50.00');
  });

  it('displays unit alongside the value', async () => {
    const component = await mountSuspended(UiSliderInput, {
      props: {
        modelValue: 25,
        min: 0,
        max: 100,
        unit: 'px',
        label: 'Size',
        decimals: 0,
      },
    });

    expect(component.text()).toContain('25px');
  });

  it('emits update:modelValue when input value changes', async () => {
    const component = await mountSuspended(UiSliderInput, {
      props: {
        modelValue: 10,
        min: 0,
        max: 100,
      },
    });

    const input = component.find('input[type="number"]');
    await input.setValue('20');

    expect(component.emitted('update:modelValue')).toBeTruthy();
    expect(component.emitted('update:modelValue')?.[0]).toEqual([20]);
  });

  it('formats value with specified decimals', async () => {
    const component = await mountSuspended(UiSliderInput, {
      props: {
        modelValue: 3.14159,
        min: 0,
        max: 10,
        decimals: 3,
        label: 'Pi',
      },
    });

    expect(component.text()).toContain('3.142');
  });

  it('displays 0 if modelValue is not finite', async () => {
    const component = await mountSuspended(UiSliderInput, {
      props: {
        modelValue: NaN,
        min: 0,
        max: 100,
        label: 'Invalid',
      },
    });

    expect(component.text()).toContain('0');
  });
});
