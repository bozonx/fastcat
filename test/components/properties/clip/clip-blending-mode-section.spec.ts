import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import ClipBlendingModeSection from '~/components/properties/clip/ClipBlendingModeSection.vue';

vi.mock('~/components/ui/UiSelect.vue', () => ({
  default: {
    props: ['modelValue', 'items', 'valueKey', 'labelKey', 'size', 'disabled'],
    emits: ['update:modelValue'],
    template: '<select class="select-mock" :value="modelValue" :disabled="disabled" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="item in items" :key="item.value" :value="item.value">{{ item.label }}</option></select>',
  },
}));

vi.mock('~/components/properties/PropertySection.vue', () => ({
  default: {
    props: ['title', 'hasToggle'],
    emits: ['update:enabled'],
    template: '<div class="section-mock"><h3>{{ title }}</h3><slot name="header-actions" /><slot /></div>',
  },
}));

describe('ClipBlendingModeSection', () => {
  const blendModeOptions = [
    { value: 'normal', label: 'Normal' },
    { value: 'multiply', label: 'Multiply' },
    { value: 'screen', label: 'Screen' },
  ];

  it('renders when clipType is not adjustment', async () => {
    const component = await mountSuspended(ClipBlendingModeSection, {
      props: { clipType: 'media', blendMode: 'normal', blendModeOptions },
    });

    expect(component.find('.section-mock').exists()).toBe(true);
  });

  it('does not render when clipType is adjustment', async () => {
    const component = await mountSuspended(ClipBlendingModeSection, {
      props: { clipType: 'adjustment', blendMode: 'normal', blendModeOptions },
    });

    expect(component.find('.section-mock').exists()).toBe(false);
  });

  it('emits updateBlendMode with normal when reset is clicked', async () => {
    const component = await mountSuspended(ClipBlendingModeSection, {
      props: { clipType: 'media', blendMode: 'multiply', blendModeOptions },
    });

    const resetButton = component.find('button[title]');
    await resetButton.trigger('click');

    expect(component.emitted('updateBlendMode')).toBeTruthy();
    expect(component.emitted('updateBlendMode')![0]).toEqual(['normal']);
  });

  it('passes blendMode value to select', async () => {
    const component = await mountSuspended(ClipBlendingModeSection, {
      props: { clipType: 'media', blendMode: 'screen', blendModeOptions },
    });

    const select = component.find('.select-mock');
    expect(select.attributes('value')).toBe('screen');
  });

  it('renders select options', async () => {
    const component = await mountSuspended(ClipBlendingModeSection, {
      props: { clipType: 'media', blendMode: 'normal', blendModeOptions },
    });

    const options = component.findAll('option');
    expect(options.length).toBe(3);
  });
});
