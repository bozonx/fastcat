import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import UiSelect from '~/components/ui/UiSelect.vue';

const stubs = {
  USelectMenu: {
    props: ['modelValue', 'items', 'placeholder', 'disabled', 'size', 'valueKey', 'labelKey', 'multiple', 'searchInput', 'ui'],
    emits: ['update:modelValue'],
    computed: {
      vk() { return this.valueKey || 'value'; },
      lk() { return this.labelKey || 'label'; },
    },
    template: `
      <div class="u-select-mock">
        <select :disabled="disabled" @change="$emit('update:modelValue', $event.target.value)">
          <option v-for="item in items" :key="item[vk]" :value="item[vk]">{{ item[lk] }}</option>
        </select>
      </div>
    `,
  },
};

describe('UiSelect', () => {
  const sampleItems = [
    { value: 'opt1', label: 'Option 1' },
    { value: 'opt2', label: 'Option 2' },
    { value: 'opt3', label: 'Option 3' },
  ];

  it('renders with items', async () => {
    const component = await mountSuspended(UiSelect, {
      props: { modelValue: 'opt1', items: sampleItems },
      global: { stubs },
    });

    expect(component.exists()).toBe(true);
    expect(component.findAll('option').length).toBe(3);
  });

  it('applies full-width class when fullWidth is true', async () => {
    const component = await mountSuspended(UiSelect, {
      props: { modelValue: 'opt1', items: sampleItems, fullWidth: true },
      global: { stubs },
    });

    expect(component.classes()).toContain('w-full');
  });

  it('applies auto width class when fullWidth is false', async () => {
    const component = await mountSuspended(UiSelect, {
      props: { modelValue: 'opt1', items: sampleItems, fullWidth: false },
      global: { stubs },
    });

    expect(component.classes()).toContain('w-auto');
  });

  it('disables select when disabled prop is true', async () => {
    const component = await mountSuspended(UiSelect, {
      props: { modelValue: 'opt1', items: sampleItems, disabled: true },
      global: { stubs },
    });

    expect(component.find('select').attributes('disabled')).toBeDefined();
  });

  it('emits update:modelValue on change', async () => {
    const component = await mountSuspended(UiSelect, {
      props: { modelValue: 'opt1', items: sampleItems },
      global: { stubs },
    });

    await component.find('select').setValue('opt2');

    expect(component.emitted('update:modelValue')).toBeTruthy();
    expect(component.emitted('update:modelValue')![0]).toEqual(['opt2']);
  });

  it('passes placeholder prop', async () => {
    const component = await mountSuspended(UiSelect, {
      props: { modelValue: undefined, items: sampleItems, placeholder: 'Choose...' },
      global: { stubs },
    });

    expect(component.find('select').exists()).toBe(true);
  });
});
