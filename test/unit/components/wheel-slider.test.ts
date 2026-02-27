import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import WheelSlider from '../../../src/components/ui/WheelSlider.vue';

describe('WheelSlider', () => {
  it('increases value on wheel up', async () => {
    const wrapper = mount(WheelSlider, {
      props: {
        modelValue: 50,
        min: 0,
        max: 100,
        step: 1,
      },
      global: {
        stubs: {
          USlider: true,
        },
      },
    });

    await wrapper.trigger('wheel', { deltaY: -100, deltaX: 0 });

    const emitted = wrapper.emitted('update:modelValue');
    expect(emitted).toBeTruthy();
    expect(emitted?.[0]).toEqual([51]);
  });

  it('decreases value on wheel down', async () => {
    const wrapper = mount(WheelSlider, {
      props: {
        modelValue: 50,
        min: 0,
        max: 100,
        step: 1,
      },
      global: {
        stubs: {
          USlider: true,
        },
      },
    });

    await wrapper.trigger('wheel', { deltaY: 100, deltaX: 0 });

    const emitted = wrapper.emitted('update:modelValue');
    expect(emitted?.[0]).toEqual([49]);
  });

  it('clamps value to max boundary', async () => {
    const wrapper = mount(WheelSlider, {
      props: {
        modelValue: 100,
        min: 0,
        max: 100,
        step: 1,
      },
      global: {
        stubs: {
          USlider: true,
        },
      },
    });

    await wrapper.trigger('wheel', { deltaY: -100, deltaX: 0 });

    const emitted = wrapper.emitted('update:modelValue');
    expect(emitted?.[0]).toEqual([100]);
  });
});
