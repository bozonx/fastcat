import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import ClipOpacitySection from '~/components/properties/clip/ClipOpacitySection.vue';

vi.mock('~/components/ui/UiSliderInput.vue', () => ({
  default: {
    props: [
      'modelValue',
      'min',
      'max',
      'step',
      'unit',
      'defaultValue',
      'wheelStepMultiplier',
      'disabled',
    ],
    emits: ['update:modelValue'],
    template:
      '<input type="range" class="slider-mock" :value="modelValue" :min="min" :max="max" :step="step" :disabled="disabled" @input="$emit(\'update:modelValue\', Number($event.target.value))" />',
  },
}));

vi.mock('~/components/properties/PropertySection.vue', () => ({
  default: {
    props: ['title', 'hasToggle', 'showReset', 'onReset'],
    emits: ['update:enabled'],
    template:
      '<div class="section-mock"><h3>{{ title }}</h3><slot name="header-actions" /><slot /></div>',
  },
}));

describe('ClipOpacitySection', () => {
  it('renders when clipType is not adjustment', async () => {
    const component = await mountSuspended(ClipOpacitySection, {
      props: { clipType: 'media', opacity: 0.5 },
    });

    expect(component.find('.section-mock').exists()).toBe(true);
  });

  it('does not render when clipType is adjustment', async () => {
    const component = await mountSuspended(ClipOpacitySection, {
      props: { clipType: 'adjustment', opacity: 0.5 },
    });

    expect(component.find('.section-mock').exists()).toBe(false);
  });

  it('emits updateOpacity with 1 when reset button is clicked', async () => {
    const component = await mountSuspended(ClipOpacitySection, {
      props: { clipType: 'media', opacity: 0.5 },
    });

    const resetButton = component.find('button[title]');
    await resetButton.trigger('click');

    expect(component.emitted('updateOpacity')).toBeTruthy();
    expect(component.emitted('updateOpacity')![0]).toEqual([1]);
  });

  it('passes opacity value to slider', async () => {
    const component = await mountSuspended(ClipOpacitySection, {
      props: { clipType: 'media', opacity: 0.75 },
    });

    const slider = component.find('.slider-mock');
    expect(slider.attributes('value')).toBe('0.75');
  });

  it('emits updateOpacity when slider changes', async () => {
    const component = await mountSuspended(ClipOpacitySection, {
      props: { clipType: 'media', opacity: 0.5 },
    });

    await component.find('.slider-mock').setValue(0.8);

    expect(component.emitted('updateOpacity')).toBeTruthy();
  });
});
