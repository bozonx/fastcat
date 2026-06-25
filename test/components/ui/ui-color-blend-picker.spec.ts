import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import UiColorBlendPicker from '~/components/ui/UiColorBlendPicker.vue';

const stubs = {
  UColorPicker: {
    props: ['modelValue', 'format', 'size'],
    emits: ['update:modelValue'],
    template:
      '<div class="color-picker-mock" @click="$emit(\'update:modelValue\', \'#ff0000\')" />',
  },
  UiSelect: {
    props: ['modelValue', 'items', 'valueKey', 'labelKey', 'size', 'fullWidth'],
    emits: ['update:modelValue'],
    template:
      '<select @change="$emit(\'update:modelValue\', $event.target.value)"><option value="normal">Normal</option></select>',
  },
  UiSliderInput: {
    props: ['modelValue', 'label', 'min', 'max', 'step', 'unit', 'decimals'],
    emits: ['update:modelValue'],
    template:
      '<input type="range" :value="modelValue" @input="$emit(\'update:modelValue\', Number($event.target.value))" />',
  },
  UiTextInput: {
    props: ['modelValue', 'placeholder', 'size', 'fullWidth', 'mono'],
    emits: ['update:modelValue', 'blur', 'keydown'],
    template:
      '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" @blur="$emit(\'blur\')" @keydown.enter="$emit(\'keydown\', $event)" />',
  },
};

describe('UiColorBlendPicker', () => {
  it('renders with default props', async () => {
    const component = await mountSuspended(UiColorBlendPicker, {
      props: { color: '#ff0000', alpha: 0.5 },
      global: { stubs },
    });

    expect(component.exists()).toBe(true);
    expect(component.find('.color-picker-mock').exists()).toBe(true);
  });

  it('emits update:color when color picker changes', async () => {
    const component = await mountSuspended(UiColorBlendPicker, {
      props: { color: '#ff0000', alpha: 0.5 },
      global: { stubs },
    });

    await component.find('.color-picker-mock').trigger('click');

    expect(component.emitted('update:color')).toBeTruthy();
    expect(component.emitted('update:color')![0]).toEqual(['#ff0000']);
  });

  it('emits update:alpha when slider changes', async () => {
    const component = await mountSuspended(UiColorBlendPicker, {
      props: { color: '#ff0000', alpha: 0.5 },
      global: { stubs },
    });

    const slider = component.find('input[type="range"]');
    await slider.setValue(80);

    expect(component.emitted('update:alpha')).toBeTruthy();
  });

  it('hides blend mode section when showBlendMode is false', async () => {
    const component = await mountSuspended(UiColorBlendPicker, {
      props: { color: '#ff0000', alpha: 0.5, showBlendMode: false },
      global: { stubs },
    });

    expect(component.findAll('select').length).toBe(0);
  });

  it('shows blend mode section when showBlendMode is true', async () => {
    const component = await mountSuspended(UiColorBlendPicker, {
      props: {
        color: '#ff0000',
        alpha: 0.5,
        showBlendMode: true,
        blendModeOptions: [{ value: 'normal', label: 'Normal' }],
      },
      global: { stubs },
    });

    expect(component.find('select').exists()).toBe(true);
  });
});
