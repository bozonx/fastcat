import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import PropertyTimecode from '~/components/properties/PropertyTimecode.vue';

vi.mock('~/components/properties/PropertyField.vue', () => ({
  default: {
    props: ['label'],
    template: '<div class="field-mock"><label>{{ label }}</label><slot /></div>',
  },
}));

vi.mock('~/components/ui/editor/UiTimecode.vue', () => ({
  default: {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<input type="number" class="timecode-mock" :value="modelValue" @input="$emit(\'update:modelValue\', Number($event.target.value))" />',
  },
}));

describe('PropertyTimecode', () => {
  it('renders label via PropertyField', async () => {
    const component = await mountSuspended(PropertyTimecode, {
      props: { label: 'Duration', modelValue: 1000 },
    });

    expect(component.text()).toContain('Duration');
  });

  it('passes modelValue to UiTimecode', async () => {
    const component = await mountSuspended(PropertyTimecode, {
      props: { label: 'Start', modelValue: 5000 },
    });

    const input = component.find('.timecode-mock');
    expect(input.attributes('value')).toBe('5000');
  });

  it('emits update:modelValue when timecode changes', async () => {
    const component = await mountSuspended(PropertyTimecode, {
      props: { label: 'End', modelValue: 1000 },
    });

    await component.find('.timecode-mock').setValue(2000);

    expect(component.emitted('update:modelValue')).toBeTruthy();
    expect(component.emitted('update:modelValue')![0]).toEqual([2000]);
  });
});
