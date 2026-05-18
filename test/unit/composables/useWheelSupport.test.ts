/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useWheelSupport, getStepPrecision } from '~/composables/useWheelSupport';
import { defineComponent, h, ref } from 'vue';
import { mount } from '@vue/test-utils';

describe('getStepPrecision', () => {
  it('returns 0 for integers', () => {
    expect(getStepPrecision(1)).toBe(0);
    expect(getStepPrecision(100)).toBe(0);
  });

  it('returns decimal places count for floats', () => {
    expect(getStepPrecision(0.1)).toBe(1);
    expect(getStepPrecision(0.01)).toBe(2);
    expect(getStepPrecision(1.234)).toBe(3);
  });
});

describe('useWheelSupport', () => {
  function mountWheelSupport(options: Partial<Parameters<typeof useWheelSupport>[0]> = {}) {
    const onWheelStep = vi.fn();
    const wrapperRef = ref<HTMLElement | null>(null);
    const disabled = ref(false);
    const step = ref(1);
    const wheelStepMultiplier = ref(5);

    const TestComp = defineComponent({
      setup() {
        wrapperRef.value = document.createElement('div');
        document.body.appendChild(wrapperRef.value);
        useWheelSupport({
          wrapperRef,
          onWheelStep,
          disabled: () => disabled.value,
          step: () => step.value,
          wheelStepMultiplier: () => wheelStepMultiplier.value,
          ...options,
        });
        return () => h('div', { ref: wrapperRef });
      },
    });

    const wrapper = mount(TestComp, { attachTo: document.body });
    return { onWheelStep, wrapperRef, disabled, step, wheelStepMultiplier, wrapper };
  }

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('calls onWheelStep with correct direction and step on wheel down', async () => {
    const { onWheelStep, wrapperRef } = mountWheelSupport();
    const event = new WheelEvent('wheel', { deltaY: 100, bubbles: true });
    wrapperRef.value!.dispatchEvent(event);
    expect(onWheelStep).toHaveBeenCalledTimes(1);
    expect(onWheelStep).toHaveBeenCalledWith(-1, 1, 0);
  });

  it('calls onWheelStep with positive direction on wheel up', async () => {
    const { onWheelStep, wrapperRef } = mountWheelSupport();
    const event = new WheelEvent('wheel', { deltaY: -50, bubbles: true });
    wrapperRef.value!.dispatchEvent(event);
    expect(onWheelStep).toHaveBeenCalledWith(1, 1, 0);
  });

  it('does nothing when disabled', async () => {
    const { onWheelStep, wrapperRef, disabled } = mountWheelSupport();
    disabled.value = true;
    const event = new WheelEvent('wheel', { deltaY: 100, bubbles: true });
    wrapperRef.value!.dispatchEvent(event);
    expect(onWheelStep).not.toHaveBeenCalled();
  });

  it('does nothing in focusOnly mode when wrapper is not focused', async () => {
    const { onWheelStep, wrapperRef } = mountWheelSupport({ focusOnly: true });
    const outsideInput = document.createElement('input');
    document.body.appendChild(outsideInput);
    outsideInput.focus();
    const event = new WheelEvent('wheel', { deltaY: 100, bubbles: true });
    wrapperRef.value!.dispatchEvent(event);
    expect(onWheelStep).not.toHaveBeenCalled();
    outsideInput.remove();
  });

  it('fires in focusOnly mode when an element inside wrapper is focused', async () => {
    const { onWheelStep, wrapperRef } = mountWheelSupport({ focusOnly: true });
    const insideInput = document.createElement('input');
    wrapperRef.value!.appendChild(insideInput);
    insideInput.focus();
    const event = new WheelEvent('wheel', { deltaY: 100, bubbles: true });
    wrapperRef.value!.dispatchEvent(event);
    expect(onWheelStep).toHaveBeenCalledTimes(1);
    insideInput.remove();
  });

  it('uses deltaX when larger than deltaY', async () => {
    const { onWheelStep, wrapperRef } = mountWheelSupport();
    const event = new WheelEvent('wheel', { deltaX: 200, deltaY: 10, bubbles: true });
    wrapperRef.value!.dispatchEvent(event);
    expect(onWheelStep).toHaveBeenCalledWith(-1, 1, 0);
  });

  it('uses custom useWheelStepMultiplier callback to accelerate step', async () => {
    const useWheelStepMultiplier = vi.fn(() => true);
    const { onWheelStep, wrapperRef } = mountWheelSupport({ useWheelStepMultiplier });
    const event = new WheelEvent('wheel', { deltaY: 100, bubbles: true });
    wrapperRef.value!.dispatchEvent(event);
    expect(useWheelStepMultiplier).toHaveBeenCalled();
    expect(onWheelStep).toHaveBeenCalledWith(-1, 5, 0);
  });

  it('falls back to step 1 when step is zero or negative', async () => {
    const { onWheelStep, wrapperRef, step } = mountWheelSupport();
    step.value = 0;
    const event = new WheelEvent('wheel', { deltaY: 100, bubbles: true });
    wrapperRef.value!.dispatchEvent(event);
    expect(onWheelStep).toHaveBeenCalledWith(-1, 1, 0);
  });

  it('ignores zero or non-finite delta', async () => {
    const { onWheelStep, wrapperRef } = mountWheelSupport();
    wrapperRef.value!.dispatchEvent(new WheelEvent('wheel', { deltaY: 0, bubbles: true }));
    wrapperRef.value!.dispatchEvent(new WheelEvent('wheel', { deltaY: Number.NaN, bubbles: true }));
    expect(onWheelStep).not.toHaveBeenCalled();
  });

  it('passes precision based on step decimal places', async () => {
    const { onWheelStep, wrapperRef, step } = mountWheelSupport();
    step.value = 0.01;
    const event = new WheelEvent('wheel', { deltaY: 100, bubbles: true });
    wrapperRef.value!.dispatchEvent(event);
    expect(onWheelStep).toHaveBeenCalledWith(-1, 0.01, 2);
  });
});
