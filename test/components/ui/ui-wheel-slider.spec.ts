import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import UiWheelSlider from '~/components/ui/UiWheelSlider.vue';

describe('UiWheelSlider', () => {
  it('renders correctly', async () => {
    const component = await mountSuspended(UiWheelSlider, {
      props: {
        modelValue: 50,
        min: 0,
        max: 100,
      },
    });

    expect(component.exists()).toBe(true);
    const wrapper = component.find('div.relative');
    expect(wrapper.exists()).toBe(true);
  });

  it('resets to default value on double click', async () => {
    const component = await mountSuspended(UiWheelSlider, {
      props: {
        modelValue: 50,
        min: 0,
        max: 100,
        defaultValue: 25,
      },
    });

    const wrapper = component.find('div.relative');
    await wrapper.trigger('dblclick');

    expect(component.emitted('update:modelValue')).toBeTruthy();
    expect(component.emitted('update:modelValue')?.[0]).toEqual([25]);
  });

  it('resets to default value on fast double pointerdown', async () => {
    const component = await mountSuspended(UiWheelSlider, {
      props: {
        modelValue: 80,
        min: 0,
        max: 100,
        defaultValue: 50,
      },
    });

    const wrapper = component.find('div.relative');

    // First pointerdown
    await wrapper.trigger('pointerdown', { button: 0, pointerType: 'mouse' });
    expect(component.emitted('update:modelValue')).toBeFalsy();

    // Second pointerdown (simulating quick double tap/click)
    await wrapper.trigger('pointerdown', { button: 0, pointerType: 'mouse' });

    expect(component.emitted('update:modelValue')).toBeTruthy();
    expect(component.emitted('update:modelValue')?.[0]).toEqual([50]);
  });

  it('does not reset to default if disabled', async () => {
    const component = await mountSuspended(UiWheelSlider, {
      props: {
        modelValue: 50,
        min: 0,
        max: 100,
        defaultValue: 25,
        disabled: true,
      },
    });

    const wrapper = component.find('div.relative');

    await wrapper.trigger('dblclick');
    expect(component.emitted('update:modelValue')).toBeFalsy();

    await wrapper.trigger('pointerdown', { button: 0, pointerType: 'mouse' });
    await wrapper.trigger('pointerdown', { button: 0, pointerType: 'mouse' });
    expect(component.emitted('update:modelValue')).toBeFalsy();
  });

  it('ignores non-primary pointerdown events', async () => {
    const component = await mountSuspended(UiWheelSlider, {
      props: {
        modelValue: 80,
        min: 0,
        max: 100,
        defaultValue: 50,
      },
    });

    const wrapper = component.find('div.relative');

    // Right click (button: 2)
    await wrapper.trigger('pointerdown', { button: 2, pointerType: 'mouse' });
    await wrapper.trigger('pointerdown', { button: 2, pointerType: 'mouse' });

    expect(component.emitted('update:modelValue')).toBeFalsy();
  });

  it('applies horizontal orientation classes by default', async () => {
    const component = await mountSuspended(UiWheelSlider, {
      props: {
        modelValue: 50,
        min: 0,
        max: 100,
      },
    });

    const wrapper = component.find('div.relative');
    expect(wrapper.classes()).toContain('py-3');
    expect(wrapper.classes()).toContain('-my-3');
  });

  it('applies vertical orientation classes when specified', async () => {
    const component = await mountSuspended(UiWheelSlider, {
      props: {
        modelValue: 50,
        min: 0,
        max: 100,
        orientation: 'vertical',
      },
    });

    const wrapper = component.find('div.relative');
    expect(wrapper.classes()).toContain('px-3');
    expect(wrapper.classes()).toContain('-mx-3');
    expect(wrapper.classes()).toContain('h-full');
  });

  it('passes custom sliderClass to the slider', async () => {
    const component = await mountSuspended(UiWheelSlider, {
      props: {
        modelValue: 50,
        min: 0,
        max: 100,
        sliderClass: 'custom-track-class',
      },
    });

    // Validates that the custom class exists somewhere in the rendered HTML (which Nuxt UI USlider will include)
    expect(component.html()).toContain('custom-track-class');
  });

  it('blurs the active element inside the wrapper on pointerup with mouse pointerType', async () => {
    const component = await mountSuspended(UiWheelSlider, {
      props: {
        modelValue: 50,
        min: 0,
        max: 100,
      },
      attachTo: document.body,
    });

    const wrapper = component.find('div.relative');
    
    // Create and append a dummy element to simulate a focused element inside the slider wrapper
    const dummyInput = document.createElement('input');
    wrapper.element.appendChild(dummyInput);
    dummyInput.focus();
    
    expect(document.activeElement).toBe(dummyInput);
    
    const blurSpy = vi.spyOn(dummyInput, 'blur');
    
    await wrapper.trigger('pointerup', { pointerType: 'mouse' });
    
    expect(blurSpy).toHaveBeenCalled();
    
    // Clean up
    dummyInput.remove();
    component.unmount();
  });
});
