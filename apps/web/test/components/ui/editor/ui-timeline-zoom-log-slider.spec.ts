import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import UiTimelineZoomLogSlider from '~/components/ui/editor/UiTimelineZoomLogSlider.vue';
import UiWheelSlider from '~/components/ui/UiWheelSlider.vue';

describe('UiTimelineZoomLogSlider', () => {
  it('renders correctly with default props', async () => {
    const component = await mountSuspended(UiTimelineZoomLogSlider, {
      props: {
        modelValue: 50,
      },
    });

    expect(component.exists()).toBe(true);
    const wheelSlider = component.findComponent(UiWheelSlider);
    expect(wheelSlider.exists()).toBe(true);
    expect(wheelSlider.props('min')).toBe(0);
    expect(wheelSlider.props('max')).toBe(110);
    expect(wheelSlider.props('step')).toBe(1);
    expect(wheelSlider.props('modelValue')).toBe(50);
  });

  it('clamps the getter modelValue if below min', async () => {
    const component = await mountSuspended(UiTimelineZoomLogSlider, {
      props: {
        modelValue: -10,
        min: 0,
        max: 100,
      },
    });

    const wheelSlider = component.findComponent(UiWheelSlider);
    expect(wheelSlider.props('modelValue')).toBe(0);
  });

  it('clamps the getter modelValue if above max', async () => {
    const component = await mountSuspended(UiTimelineZoomLogSlider, {
      props: {
        modelValue: 150,
        min: 0,
        max: 100,
      },
    });

    const wheelSlider = component.findComponent(UiWheelSlider);
    expect(wheelSlider.props('modelValue')).toBe(100);
  });

  it('returns 50 if modelValue is not finite', async () => {
    const component = await mountSuspended(UiTimelineZoomLogSlider, {
      props: {
        modelValue: NaN,
      },
    });

    const wheelSlider = component.findComponent(UiWheelSlider);
    expect(wheelSlider.props('modelValue')).toBe(50);
  });

  it('emits update:modelValue when inner slider emits an update', async () => {
    const component = await mountSuspended(UiTimelineZoomLogSlider, {
      props: {
        modelValue: 50,
      },
    });

    const wheelSlider = component.findComponent(UiWheelSlider);
    await wheelSlider.vm.$emit('update:modelValue', 75);

    expect(component.emitted('update:modelValue')).toBeTruthy();
    expect(component.emitted('update:modelValue')?.[0]).toEqual([75]);
  });

  it('clamps emitted value if inner slider emits out of bounds', async () => {
    const component = await mountSuspended(UiTimelineZoomLogSlider, {
      props: {
        modelValue: 50,
        min: 0,
        max: 100,
      },
    });

    const wheelSlider = component.findComponent(UiWheelSlider);
    await wheelSlider.vm.$emit('update:modelValue', 120);

    expect(component.emitted('update:modelValue')).toBeTruthy();
    expect(component.emitted('update:modelValue')?.[0]).toEqual([100]);

    await wheelSlider.vm.$emit('update:modelValue', -20);
    expect(component.emitted('update:modelValue')?.[1]).toEqual([0]);
  });

  it('does not emit update if the inner slider emits an invalid value', async () => {
    const component = await mountSuspended(UiTimelineZoomLogSlider, {
      props: {
        modelValue: 50,
      },
    });

    const wheelSlider = component.findComponent(UiWheelSlider);
    await wheelSlider.vm.$emit('update:modelValue', NaN);

    expect(component.emitted('update:modelValue')).toBeFalsy();
  });

  it('passes sliderClass down to UiWheelSlider', async () => {
    const component = await mountSuspended(UiTimelineZoomLogSlider, {
      props: {
        modelValue: 50,
        sliderClass: 'custom-zoom-class',
      },
    });

    const wheelSlider = component.findComponent(UiWheelSlider);
    expect(wheelSlider.props('sliderClass')).toBe('custom-zoom-class');
  });
});
